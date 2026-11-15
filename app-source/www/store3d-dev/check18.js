'use strict';
// בדיקת דפדפן לשלב 19א (תמונה לכל מקום צילום). כל התמונות נוצרות בקוד דף הבדיקה (slots.html), לא נכנסות לאפליקציה.
// הרצה: node app-source/www/store3d-dev/check18.js [תוצאות.json]   (דורש playwright + Chromium)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2' };
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
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 1, hasTouch: true, locale: 'he-IL' });
  const R = { checks: [] }, errors = [];
  const check = (name, ok, ev) => { R.checks.push({ name, ok: !!ok, ev }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' – ' + (typeof ev === 'string' ? ev : JSON.stringify(ev))); };
  const open = async (qs) => { const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
    await page.goto(base + '/store3d-dev/slots.html' + qs, { waitUntil: 'load' }); await page.waitForFunction(() => window.__h || window.__m, null, { timeout: 30000 }); await sleep(600); return page; };
  /* מקטע גבוה (lv t,b) לעמוד מולו: 1.2 מ' מהחזית, ומקום רחוק (מעל 6 מ') */
  const geom = (page) => page.evaluate(() => { const M = window.__model, b = M.bays.filter((o) => o.lv.length > 1)[0], out = { id: b.id, hiN: M.bays.filter((o) => o.lv.length > 1).length, near: null, far: null };
    /* נקודת עמידה מול המקטע, בתוך החדר (מנסים את שני כיווני הנורמלה, כי כיוון הגוף בתוכנית אינו ידוע כאן) */
    for (const sg of [1, -1]) for (const d of [120, 90, 60]) { const x = b.x + sg * b.nx * d, y = b.y + sg * b.ny * d; if (!out.near && S3G.inAnyRoom(M, x, y)) out.near = [x, y]; }
    const ok = (x, y) => M.bays.every((o) => Math.hypot(x - o.x, y - o.y) > 700);
    for (let x = 100; x <= 1700 && !out.far; x += 100) for (let y = 100; y <= 1500 && !out.far; y += 100) if (S3G.inAnyRoom(M, x, y) && ok(x, y)) out.far = [x, y];
    return out; });
  const stand = async (page, x, y) => { await page.evaluate(([x, y]) => window.__h.walkTo(x, y), [x, y]); await sleep(1500); };

  /* 1. הליכה: שני חצאי החזית, th ואחר כך p */
  let page = await open('?mode=walk');
  const G = await geom(page);
  check('במפת הבדיקה יש מקטעים גבוהים עם lv:[t,b]', G.hiN >= 2, G);
  const near = G.near;
  const before = await page.evaluate(() => window.__phCalls.length);
  let maxFull = 0;
  const poll = setInterval(() => page.evaluate(() => window.__h.stats().slots.full).then((n) => { maxFull = Math.max(maxFull, n); }).catch(() => {}), 80);
  await stand(page, near[0], near[1]); await sleep(2500);
  const s1 = await page.evaluate(() => ({ st: window.__h.stats(), calls: window.__phCalls.slice(), loads: window.__loads.filter((p) => /_p\.jpg$/.test(p)) }));
  const slots = s1.calls.filter((c) => c.indexOf('/' + G.id + '_') >= 0);
  check('נקרא מסמך ph לשני חצאי המקטע (t ו-b)', slots.some((c) => c.endsWith('_t')) && slots.some((c) => c.endsWith('_b')), slots);
  const pl = s1.loads.filter((p) => p.indexOf('/' + G.id + '_') >= 0);
  check('אחרי עמידה נטענו תמונות מלאות שונות לחצי העליון והתחתון', pl.length === 2 && pl[0] !== pl[1], pl);
  check('בזיכרון תמונות מלאות, ולעולם לא יותר מ-4', s1.st.slots.full >= 1 && s1.st.slots.full <= 4 && maxFull <= 4, { full: s1.st.slots.full, maxFull });
  check('הציור מכיל את מקומות הצילום (th + p)', s1.st.slots.th >= 2, s1.st.slots);
  /* 2. התרחקות משחררת */
  await stand(page, G.far[0], G.far[1]); await sleep(1200);
  const s2 = await page.evaluate(() => window.__h.stats());
  check('כשמתרחקים: התמונות המלאות משוחררות', s2.slots.full === 0, s2.slots);
  const c2 = await page.evaluate(() => window.__phCalls.length);
  await sleep(1500);
  check('רחוק ממקטעים (מעל 6 מטר): אין קריאות נוספות', (await page.evaluate(() => window.__phCalls.length)) === c2, c2);
  /* 3. מבט עליון: אין קריאות */
  await page.evaluate(() => window.__h.setMode('top')); await sleep(300);
  const c3 = await page.evaluate(() => window.__phCalls.length);
  await sleep(1500);
  const s3 = await page.evaluate(() => ({ n: window.__phCalls.length, st: window.__h.stats() }));
  check('מבט עליון: 0 קריאות loadPh ו-0 תמונות מלאות', s3.n === c3 && s3.st.slots.full === 0, { c3, n: s3.n });
  clearInterval(poll); await page.close();

  /* 4. מקרים חריגים: חסר / אדם / נתיב לא חוקי / שגיאה – בלי שגיאה ובלי ציור */
  page = await open('?mode=walk');
  for (const [sl, kind] of [[G.id + '_t', 'person'], [G.id + '_b', 'missing']]) await page.evaluate(([s, k]) => { window.__special[s] = k; }, [sl, kind]);
  await stand(page, near[0], near[1]); await sleep(2500);
  const s4 = await page.evaluate(() => ({ st: window.__h.stats(), loads: window.__loads.filter((p) => /_(t|p)\.jpg$/.test(p)) }));
  check('אדם בתמונה / מסמך חסר: לא נטענה תמונה למקום הזה, בלי שגיאה', !s4.loads.some((p) => p.indexOf('/' + G.id + '_') >= 0 && /_p\.jpg$/.test(p)) && s4.st.slots.full === 0 && errors.length === 0, { slots: s4.st.slots, errors });
  await page.close();
  page = await open('?mode=walk');
  await page.evaluate((id) => { window.__special[id + '_t'] = 'bad'; window.__special[id + '_b'] = 'err'; }, G.id);
  await stand(page, near[0], near[1]); await sleep(2500);
  const s5 = await page.evaluate(() => ({ st: window.__h.stats(), loads: window.__loads.slice() }));
  check('נתיב לא חוקי (okPath) / שגיאה: אין הורדה ואין תמונה, בלי שגיאה', s5.st.slots.full === 0 && !s5.loads.some((p) => /x\.jpg|\.\./.test(p)) && errors.length === 0, { slots: s5.st.slots, errors });
  await page.close();

  /* 5. בלי loadPh: התנהגות קיימת */
  page = await open('?mode=walk&noph=1');
  await stand(page, near[0], near[1]); await sleep(1500);
  const s6 = await page.evaluate(() => ({ st: window.__h.stats(), n: window.__phCalls.length }));
  check('בלי opts.loadPh: אין קריאות ואין שכבה חדשה (הליכה כמו היום, hi עדיין נטען)', s6.n === 0 && !s6.st.slots.on && s6.st.slots.full === 0 && s6.st.photos.hi >= 1, { n: s6.n, slots: s6.st.slots, hi: s6.st.photos.hi });
  await page.close();

  /* 6. מיני */
  page = await open('?mini=1'); await sleep(2000);
  const s7 = await page.evaluate(() => ({ n: window.__phCalls.length, st: window.__m.stats() }));
  check('מצב מיני: 0 קריאות loadPh', s7.n === 0, s7.n);
  await page.close();

  check('אין שגיאות JavaScript', errors.length === 0, errors);
  await browser.close(); srv.close();
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(R, null, 1));
  process.exit(R.checks.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
