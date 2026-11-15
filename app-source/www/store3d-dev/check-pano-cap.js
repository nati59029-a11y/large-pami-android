'use strict';
// בדיקת דפדפן לשלב 18ו (צילום 360 בטלפון): צילום מדומה מלא ב-360x760 + מצבי שגיאה. הסצנה נוצרת בקוד דף הבדיקה (pano-cap.html), לא נכנסת לאפליקציה.
// הרצה: node app-source/www/store3d-dev/check-pano-cap.js [פלט.jpg] [צילום-מסך.png] [תוצאות.json] [פלט-סרטון.jpg] [צילום-מסך-סרטון.png] [פלט-עם-סטייה-ויישור.jpg]   (דורש playwright + Chromium)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const [outJpg, shot, outJson] = [process.argv[2] || 'pano-cap-out.jpg', process.argv[3] || 'pano-cap-360.png', process.argv[4]];
const [vidJpg, vidShot] = [process.argv[5] || 'pano-cap-video.jpg', process.argv[6] || 'pano-cap-video.png'];
const alJpg = process.argv[7] || 'pano-cap-aligned.jpg';
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
  /* חומר גולמי של הצילום האחרון */
  const raw = await page.evaluate(() => window.__raw());
  if (raw) { const { meta, ...rr } = raw; R.raw = { ...rr, meta: meta && { ...meta, frames: meta.frames.length } }; }
  const n0 = typeof res === 'object' ? res.meta.n : -1, mf = raw && raw.meta && raw.meta.frames;
  check('lastRaw: zip תקין (PK, רשומות = פריימים + meta.json, כל ה-JPEG תקינים)', raw && raw.type === 'application/zip' && raw.pk && raw.eocd && !raw.bad && raw.count === n0 + 1 && raw.jpg === n0 && raw.names[n0] === 'meta.json', raw && { count: raw.count, jpg: raw.jpg, bytes: raw.bytes, ms: raw.ms, n: n0 });
  check('lastRaw: meta.json – כיוון לכל פריים (q + qFix + fixDeg), FOV, ממדי וידאו, דגם, יישור', raw && raw.meta && raw.meta.kind === 's3pano-raw' && mf.length === n0 && mf.every((f) => f.q.length === 4 && f.qFix && f.qFix.length === 4 && f.fixDeg && f.fixDeg.length === 3 && f.w > 0) && raw.meta.video.w === 360 && raw.meta.fovL > 30 && typeof raw.meta.ua === 'string' && raw.meta.ua.length > 5 && raw.meta.align && raw.meta.align.used > 0,
    raw && raw.meta && { video: raw.meta.video, fovL: raw.meta.fovL, align: raw.meta.align, maxFix: Math.max(...mf.map((f) => Math.hypot(...(f.fixDeg || [0])))).toFixed(3) });
  await page.close();
  { const p = await open(); const r2 = await p.evaluate(async () => { const b = await S3PanoCap.lastRaw(); return b ? 'blob' : 'null'; });
    check('lastRaw בעמוד חדש (אין צילום): null', r2 === 'null', r2); await p.close(); }

  /* ---------- 1ב. יישור עדין: החיישן סוטה לאט (עד 1.5°) – עם יישור מול בלי ---------- */
  const driftRun = async (noAlign) => { const p = await open();
    await p.evaluate((a) => { window.__res = undefined; window.__run(a).then((r) => (window.__res = r || 'null'), (e) => (window.__res = 'err:' + e.message)); }, { drift: 1.5, noAlign, b64: !noAlign, width: 2048 });
    await p.waitForFunction(() => window.__res, null, { timeout: 240000 }); const r = await p.evaluate(() => window.__res);
    const rw = typeof r === 'object' ? await p.evaluate(() => window.__raw()) : null; await p.close(); return { r, al: rw && rw.meta && rw.meta.align }; };
  const dA = await driftRun(false), dN = await driftRun(true);
  if (typeof dA.r === 'object' && typeof dN.r === 'object') {
    fs.writeFileSync(alJpg, Buffer.from(dA.r.fullB64, 'base64')); R.drift = { errNoAlign: dN.r.err, errAlign: dA.r.err, msNoAlign: dN.r.meta.ms, msAlign: dA.r.meta.ms, align: dA.al };
    check('יישור עדין בדפדפן: סטייה מדומה של החיישן – השגיאה מול הסצנה יורדת משמעותית', dA.r.err < dN.r.err * 0.7 && dA.r.err < 12, R.drift);
  } else check('יישור עדין בדפדפן: שתי ההרצות הסתיימו', false, { a: dA.r, n: dN.r });

  /* ---------- 1ג. אזהרה כשהטלפון זז (מד תאוצה מדומה) ---------- */
  for (const [acc, want] of [[3, true], [0.2, false]]) {
    const p = await open();
    await p.evaluate((a) => { window.__res = undefined; window.__run({ shake: a, speed: 60 }).then((r) => (window.__res = r === null ? 'null' : 'value')); }, acc);
    await p.waitForFunction(() => { const c = document.querySelector('.s3pc-cnt'); return c && /צולמו [1-9]/.test(c.textContent); }, null, { timeout: 30000 });
    await p.waitForFunction(() => /בלי להזיז/.test(document.querySelector('.s3pc-hint').textContent), null, { timeout: 2500 }).catch(() => {});
    const hh = await p.evaluate(() => ({ hint: document.querySelector('.s3pc-hint').textContent, warn: document.querySelector('.s3pc-hint').classList.contains('warn'), cnt: document.querySelector('.s3pc-cnt').textContent }));
    const got = hh.hint === 'סובבו את הטלפון במקום, בלי להזיז אותו';
    check(want ? 'תאוצה ליניארית 3 מ\'/ש²: הודעה "סובבו את הטלפון במקום, בלי להזיז אותו" (בלי לחסום)' : 'תאוצה קטנה (0.2 מ\'/ש²): אין הודעת תזוזה', want ? got && hh.warn : !got, hh);
    await p.evaluate(() => S3PanoCap.close()); await p.close();
  }

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

  /* ---------- 4. מצב סרטון (אחרי כל בדיקות מצב הנקודות, כי הבחירה נשמרת בטלפון) ---------- */
  const pv = await open();
  await pv.evaluate(() => { window.__res = undefined; window.__cnts = []; window.__run({ b64: true, vspeed: 40 }).then((r) => (window.__res = r || 'null'), (e) => (window.__res = 'err:' + e.message));
    const iv = setInterval(() => { const c = document.querySelector('.s3pc-cnt'); if (c) { const t = c.textContent; if (window.__cnts[window.__cnts.length - 1] !== t) window.__cnts.push(t); } if (window.__res) clearInterval(iv); }, 30); });
  await pv.waitForFunction(() => { const b = document.querySelector('.s3pc [data-k=mv]'); return b && !b.disabled && document.querySelector('.s3pc-cnt').textContent; }, null, { timeout: 15000 });
  const def = await pv.evaluate(() => document.querySelector('.s3pc [data-k=mp]').getAttribute('aria-pressed'));
  await pv.click('.s3pc [data-k=mv]');
  const vui = await pv.evaluate(() => { const q = (s) => document.querySelector(s), d = q('.s3pc-bar [data-k=d]');
    return { def: null, ins: q('.s3pc-ins').textContent, tip: q('.s3pc-tip').hidden ? '' : q('.s3pc-tip').textContent, cnt: q('.s3pc-cnt').textContent, d: d.textContent, rHidden: q('.s3pc-bar [data-k=r]').hidden, map: !q('.s3pc-map').hidden, ls: localStorage.getItem('lp-s3pc-mode'),
      seg: [...document.querySelectorAll('.s3pc-seg button')].map((b) => ({ t: b.textContent, p: b.getAttribute('aria-pressed'), h: Math.round(b.getBoundingClientRect().height) })) }; });
  vui.def = def;
  check('בחירת מצב: ברירת מחדל "נקודות"; "סרטון" מציג הנחיה, מפת כיסוי, כפתור "הקלטה", ונשמר בטלפון', def === 'true' && vui.ins.includes('סיבוב אחד באמצע, סיבוב אחד למעלה וסיבוב אחד למטה') && /כוסו 0 מתוך \d+/.test(vui.cnt) && vui.d === 'הקלטה' && vui.rHidden && vui.map && vui.ls === 'video' && vui.seg[1].p === 'true' && vui.seg.every((b) => b.h >= 40) && vui.tip === 'החזיקו את הטלפון קרוב לגוף והסתובבו עם כל הגוף; עצמים קרובים מאוד עלולים להיראות כפולים', vui);
  await pv.click('.s3pc-bar [data-k=d]');
  await pv.waitForFunction(() => { const c = document.querySelector('.s3pc-cnt'); return c && /כוסו ([6-9]|\d\d)/.test(c.textContent); }, null, { timeout: 90000 });
  const vui2 = await pv.evaluate(() => { const q = (s) => document.querySelector(s); return { d: q('.s3pc-bar [data-k=d]').textContent, segDis: [...document.querySelectorAll('.s3pc-seg button')].map((b) => b.disabled), hint: q('.s3pc-hint').textContent, overflow: document.documentElement.scrollWidth > innerWidth,
    tipHidden: q('.s3pc-tip').hidden, bar: [...q('.s3pc-bar').querySelectorAll('button')].filter((b) => !b.hidden).map((b) => Math.round(b.getBoundingClientRect().height)) }; });
  await pv.screenshot({ path: vidShot });
  check('בזמן הקלטה: כפתור "סיום", אי אפשר להחליף מצב, כפתורים בגובה 44 לפחות, בלי גלישה לרוחב', vui2.d === 'סיום' && vui2.tipHidden && vui2.segDis[0] && !vui2.overflow && vui2.bar.every((h) => h >= 44), vui2);
  await pv.waitForFunction(() => window.__res, null, { timeout: 300000 });
  const vres = await pv.evaluate(() => window.__res), cnts = await pv.evaluate(() => window.__cnts);
  if (typeof vres !== 'object') check('מצב סרטון: הקלטה מדומה הסתיימה', false, vres);
  else {
    const { fullB64, ...rest } = vres; R.video = rest; fs.writeFileSync(vidJpg, Buffer.from(fullB64, 'base64'));
    const lastCnt = cnts[cnts.length - 1] || '', m = /כוסו (\d+) מתוך (\d+)/.exec(lastCnt);
    check('מצב סרטון: כיסוי מלא וסיום אוטומטי', m && m[1] === m[2], lastCnt);
    check('מצב סרטון: meta.mode=video ומספר פריימים סביר (לכל היותר אחד לכל נקודה)', vres.meta.mode === 'video' && vres.meta.n >= 20 && m && vres.meta.n <= +m[2], vres.meta);
    check('מצב סרטון: 4096×2048, JPEG עד 2.5MB, קטנה 1024×512 עד 150KB', (vres.w === 4096 || vres.w === 2048) && vres.full.w === vres.w && vres.full.h === vres.w / 2 && vres.type === 'image/jpeg' && vres.fullBytes <= 2500000 && vres.sm.w === 1024 && vres.smBytes <= 150000, { full: vres.full, bytes: vres.fullBytes, sm: vres.smBytes });
    const pe = R.full ? R.full.err : null;
    check('מצב סרטון: שגיאה מול הסצנה בסדר גודל של מצב הנקודות', vres.err < 12 && (pe == null || vres.err <= Math.max(pe * 1.6, pe + 2)), { video: vres.err, pts: pe });
    if (R.full) check('מצב הנקודות מחזיר meta.mode=pts', R.full.meta.mode === 'pts', R.full.meta.mode);
  }
  await pv.close();
  /* מהר מדי: אזהרה ואין דגימה; הבחירה "סרטון" נשמרה מהפעם הקודמת */
  const pf = await open();
  await pf.evaluate(() => { window.__res = undefined; window.__run({ spin: 150 }).then((r) => (window.__res = r === null ? 'null' : 'value')); });
  await pf.waitForFunction(() => { const b = document.querySelector('.s3pc [data-k=mv]'); return b && document.querySelector('.s3pc-cnt').textContent; }, null, { timeout: 15000 });
  const kept = await pf.evaluate(() => document.querySelector('.s3pc [data-k=mv]').getAttribute('aria-pressed'));
  await pf.click('.s3pc-bar [data-k=d]');
  await pf.waitForFunction(() => /לאט יותר/.test(document.querySelector('.s3pc-hint').textContent), null, { timeout: 5000 }).catch(() => {});
  await sleep(1500);
  const fast = await pf.evaluate(() => ({ hint: document.querySelector('.s3pc-hint').textContent, warn: document.querySelector('.s3pc-hint').classList.contains('warn'), cnt: document.querySelector('.s3pc-cnt').textContent }));
  check('הבחירה האחרונה נשמרה; סיבוב מהיר (150°/ש\'): "לאט יותר" ואף פריים לא נשמר', kept === 'true' && fast.hint === 'לאט יותר' && fast.warn && /כוסו 0 /.test(fast.cnt), { kept, ...fast });
  await pf.evaluate(() => S3PanoCap.close()); await pf.close();
  /* סיום ידני באמצע: חורים מתמלאים, תוצאה תקינה */
  const pm = await open();
  await pm.evaluate(() => { window.__res = undefined; window.__run({ vspeed: 40 }).then((r) => (window.__res = r || 'null'), (e) => (window.__res = 'err:' + e.message)); });
  await pm.waitForFunction(() => { const b = document.querySelector('.s3pc [data-k=d]'); return b && document.querySelector('.s3pc-cnt').textContent; }, null, { timeout: 15000 });
  await pm.click('.s3pc-bar [data-k=d]');
  await pm.waitForFunction(() => /כוסו ([5-9]|1\d)/.test(document.querySelector('.s3pc-cnt').textContent), null, { timeout: 60000 });
  await pm.click('.s3pc-bar [data-k=d]');
  await pm.waitForFunction(() => window.__res, null, { timeout: 120000 });
  const mres = await pm.evaluate(() => window.__res);
  check('מצב סרטון: סיום ידני באמצע מחבר את מה שיש (חורים ממולאים)', typeof mres === 'object' && mres.meta.mode === 'video' && mres.meta.n >= 2 && mres.meta.n < 20 && mres.full.w === mres.w, typeof mres === 'object' ? mres.meta : mres);
  await pm.close();

  check('אין שגיאות JS', errors.length === 0, errors.slice(0, 5));
  await browser.close(); srv.close();
  const fail = R.checks.filter((c) => !c.ok).length;
  if (outJson) fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(fail ? `נכשלו ${fail} בדיקות` : `כל ${R.checks.length} הבדיקות עברו`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
