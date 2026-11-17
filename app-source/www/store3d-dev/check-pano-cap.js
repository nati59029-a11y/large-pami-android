'use strict';
// בדיקת דפדפן לשלב 18ו (צילום 360 בטלפון): צילום מדומה מלא ב-360x760 + מצבי שגיאה. הסצנה נוצרת בקוד דף הבדיקה (pano-cap.html), לא נכנסת לאפליקציה.
// הרצה: node app-source/www/store3d-dev/check-pano-cap.js [פלט.jpg] [צילום-מסך.png] [תוצאות.json] [פלט-סרטון.jpg] [צילום-מסך-סרטון.png] [פלט-עם-סטייה-ויישור.jpg]   (דורש playwright + Chromium)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const [outJpg, shot, outJson] = [process.argv[2] || 'pano-cap-out.jpg', process.argv[3] || 'pano-cap-360.png', process.argv[4]];
const [vidJpg, vidShot] = [process.argv[5] || 'pano-cap-video.jpg', process.argv[6] || 'pano-cap-video.png'];
const alJpg = process.argv[7] || 'pano-cap-aligned.jpg';
const shotFloor = process.argv[8] || 'pano-cap-floor-360.png';
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

  check('דילוג על הרצפה (ברירת מחדל בבדיקות): אין role באף פריים ב-meta הגולמי', mf && mf.length === n0 && mf.every((f) => f.role === undefined), mf && mf.map((f) => f.role).filter(Boolean));

  /* ---------- 1ג. שלב 21ה: שכבת עזר, שלב רצפה (צילום), חפיפה 0.4 ---------- */
  let tot0 = -1;
  {
    const p = await open(); /* מספר היעדים נקבע בזמן הריצה: אחרי הצילום הראשון הכיול (62°) נשמר ומשנה את מספר היעדים */
    await p.evaluate(() => { localStorage.removeItem('lp-s3pc-help'); });
    await p.evaluate(() => { window.__res = undefined; window.__run({ floor: 'manual', width: 2048 }).then((r) => (window.__res = r || 'null'), (e) => (window.__res = 'err:' + e.message)); });
    await p.waitForSelector('.s3pc-cnt', { timeout: 15000 });
    const st = () => p.evaluate(() => window.__api.state());
    const helpUi = await p.evaluate(() => { const b = document.querySelector('.s3pc [data-k=ol]'); return { t: b.textContent, p: b.getAttribute('aria-pressed'), h: Math.round(b.getBoundingClientRect().height), vis: !b.hidden, tip: document.querySelector('.s3pc-tip').textContent }; });
    check('שכבת עזר: כפתור "שכבת עזר" מוצג, פעיל כברירת מחדל, גובה 44 לפחות; טיפ: עמדו במרכז החדר', helpUi.t === 'שכבת עזר' && helpUi.p === 'true' && helpUi.h >= 44 && helpUi.vis && helpUi.tip.includes('עמדו במרכז החדר, רחוק מרהיטים') && helpUi.tip.includes('סובבו את הטלפון סביב המצלמה'), helpUi);
    await p.waitForFunction(() => { const s = window.__api && window.__api.state(); return s && s.n >= 6; }, null, { timeout: 90000 });
    await p.waitForFunction(() => window.__api.state().ovn > 0, null, { timeout: 20000 }).catch(() => {});
    const s1 = await st();
    check('שכבת עזר: מצוירת על הקנבס כשהכיוון חופף לפריים שצולם', s1.ovn > 0 && s1.help === true, s1);
    await p.click('.s3pc [data-k=ol]'); const s2 = await st(); await sleep(700); const s3 = await st();
    const ls1 = await p.evaluate(() => localStorage.getItem('lp-s3pc-help'));
    check('שכבת עזר: כיבוי – לא מציירת יותר, נשמר ב-localStorage', s2.help === false && s3.ovn === s2.ovn && ls1 === '0', { s2: s2.ovn, s3: s3.ovn, ls1 });
    await p.click('.s3pc [data-k=ol]');
    await p.waitForFunction((n) => window.__api.state().ovn > n, s3.ovn, { timeout: 30000 }).catch(() => {});
    const s4 = await st(); const ls2 = await p.evaluate(() => localStorage.getItem('lp-s3pc-help'));
    check('שכבת עזר: הדלקה מחדש – מציירת שוב ונשמר', s4.help === true && s4.ovn > s3.ovn && ls2 === '1', { s3: s3.ovn, s4: s4.ovn, ls2 });
    await p.click('.s3pc [data-k=ol]'); /* משאירים כבוי לבדיקת זיכרון בהפעלה הבאה */
    await p.waitForFunction(() => /שלב אחרון/.test(document.querySelector('.s3pc-cnt').textContent), null, { timeout: 240000 });
    const fl = await p.evaluate(() => { const fb = document.querySelector('.s3pc-fb'), bs = [...fb.querySelectorAll('button')], top = document.querySelector('.s3pc-top').getBoundingClientRect();
      return { vis: !fb.hidden, txt: fb.querySelector('.s3pc-fi').textContent, btn: bs.map((b) => ({ t: b.textContent, h: Math.round(b.getBoundingClientRect().height) })), overflow: document.documentElement.scrollWidth > innerWidth, topH: Math.round(top.height), tot: window.__api.state().tot, n: window.__api.state().n, ol: document.querySelector('.s3pc [data-k=ol]').hidden }; });
    await p.screenshot({ path: shotFloor });
    check('שלב רצפה: ההוראה בעברית, כפתורי "צלם" ו"דלג" בגובה 44 לפחות, בלי גלישה לרוחב', fl.vis && fl.txt === 'זוזו צעד אחד הצידה, וכוונו את המצלמה ישר למטה, למקום שבו עמדתם' && fl.btn.map((b) => b.t).join() === 'צלם,דלג' && fl.btn.every((b) => b.h >= 44) && !fl.overflow, fl);
    tot0 = fl.tot;
    check('שלב רצפה מופיע רק אחרי כל נקודות היעד (' + fl.tot + ')', fl.n === fl.tot && fl.tot >= 40, { n: fl.n, tot: fl.tot });
    await p.evaluate(() => { window.__hold = true; window.__pset = -30; }); await sleep(150);
    await p.click('.s3pc [data-k=fs]'); await sleep(500);
    const rej = await p.evaluate(() => ({ cnt: document.querySelector('.s3pc-cnt').textContent, hint: document.querySelector('.s3pc-hint').textContent, open: !!document.querySelector('.s3pc') }));
    check('שלב רצפה: בלי כיוון למטה (פחות מ-75°-) לא מצלמים; ההודעה מבקשת לכוון למטה', rej.open && /שלב אחרון/.test(rej.cnt) && rej.hint.includes('ישר למטה'), rej);
    await p.evaluate(() => { window.__pset = -88; }); await sleep(300);
    await p.click('.s3pc [data-k=fs]');
    await p.waitForFunction(() => window.__res, null, { timeout: 240000 });
    const fr = await p.evaluate(() => window.__res);
    const rw = await p.evaluate(() => window.__raw()); const fm = rw && rw.meta && rw.meta.frames;
    check('צילום רצפה: הפריים האחרון role=nadir ב-meta הגולמי, כל השאר בלי role, מספר הפריימים = יעדים + 1', typeof fr === 'object' && fm && fm.length === tot0 + 1 && fm[fm.length - 1].role === 'nadir' && fm.slice(0, -1).every((f) => f.role === undefined) && fr.meta.n === tot0 + 1, fm && fm.map((f) => f.role).filter(Boolean).concat([fm.length, tot0]));
    check('צילום רצפה (חיבור JS): התוצאה תקינה ושגיאה מול הסצנה סבירה', typeof fr === 'object' && fr.err < 14 && fr.w === 2048, typeof fr === 'object' ? { err: fr.err, w: fr.w } : fr);
    await p.close();
  }
  { /* שכבת העזר שנכבתה נשמרת להפעלה הבאה; "דלג" בשלב הרצפה */
    const p = await open();
    await p.evaluate(() => { window.__res = undefined; window.__run({ floor: 'manual', width: 2048 }).then((r) => (window.__res = r || 'null'), (e) => (window.__res = 'err:' + e.message)); });
    await p.waitForSelector('.s3pc-cnt', { timeout: 15000 });
    const pr = await p.evaluate(() => document.querySelector('.s3pc [data-k=ol]').getAttribute('aria-pressed'));
    check('שכבת עזר: הבחירה (כבוי) נשמרה להפעלה הבאה', pr === 'false', pr);
    await p.click('.s3pc [data-k=ol]'); await p.evaluate(() => localStorage.setItem('lp-s3pc-help', '1'));
    await p.waitForFunction(() => /שלב אחרון/.test(document.querySelector('.s3pc-cnt').textContent), null, { timeout: 240000 });
    await p.click('.s3pc [data-k=fk]');
    await p.waitForFunction(() => window.__res, null, { timeout: 240000 });
    const fr = await p.evaluate(() => window.__res), rw = await p.evaluate(() => window.__raw()), fm = rw && rw.meta && rw.meta.frames;
    check('דילוג על הרצפה: מסתיים כרגיל בלי פריים רצפה (התנהגות קודמת)', typeof fr === 'object' && fr.meta.n === tot0 && fm.every((f) => f.role === undefined), typeof fr === 'object' ? { n: fr.meta.n } : fr);
    await p.close();
  }

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
  check('בחירת מצב: ברירת מחדל "נקודות"; "סרטון" מציג הנחיה, מפת כיסוי, כפתור "הקלטה", ונשמר בטלפון', def === 'true' && vui.ins.includes('סיבוב אחד באמצע, סיבוב אחד למעלה וסיבוב אחד למטה') && /כוסו 0 מתוך \d+/.test(vui.cnt) && vui.d === 'הקלטה' && vui.rHidden && vui.map && vui.ls === 'video' && vui.seg[1].p === 'true' && vui.seg.every((b) => b.h >= 40) && vui.tip === 'עמדו במרכז החדר, רחוק מרהיטים; סובבו את הטלפון סביב המצלמה. עצמים קרובים מאוד עלולים להיראות כפולים', vui);
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

  /* ---------- 5. תמונה אמיתית מדומה (ImageCapture) + נעילות (שלב 21ב); מצב נקודות מפורש כי הבחירה נשמרת ---------- */
  const phRun = async (name, o, early) => {
    const p = await open();
    await p.evaluate((a) => { try { localStorage.removeItem('lp-s3pc-fovL'); localStorage.removeItem('lp-s3pc-fovL-ph'); } catch (e) {} window.__res = undefined; window.__run(a).then((r) => (window.__res = r || 'null'), (e) => (window.__res = 'err:' + e.message)); }, { mode: 'pts', width: 2048, hdr: 0, ...o });
    if (early) { await p.waitForFunction((n) => { const c = document.querySelector('.s3pc-cnt'); return window.__res || (c && new RegExp('צולמו ([' + n + '-9]|[1-9]\\d) ').test(c.textContent)); }, early, { timeout: 120000 }); if (!(await p.evaluate(() => window.__res))) await p.click('.s3pc-bar [data-k=d]'); }
    await p.waitForFunction(() => window.__res, null, { timeout: 240000 });
    const r = await p.evaluate(() => window.__res), raw = typeof r === 'object' ? await p.evaluate(() => window.__raw()) : null;
    const x = await p.evaluate(() => ({ applied: window.__applied || [], calls: window.__photoCalls || 0, ls: { v: localStorage.getItem('lp-s3pc-fovL'), ph: localStorage.getItem('lp-s3pc-fovL-ph') }, shots: window.__shots || [], hints: window.__hints || [], exp: window.__exp || null }));
    await p.close(); return { r, raw, ...x };
  };
  const srcOf = (q) => (q.raw && q.raw.meta ? q.raw.meta.frames.map((f) => f.src) : []);
  const cnt = (a, v) => a.filter((x) => x === v).length;
  const okRes = (q, early) => typeof q.r === 'object' && (early || q.r.err < 12) && q.r.full.w === q.r.w;
  const pOk = await phRun('photo ok', { photo: 'ok', caps: 'full' });
  { const s = srcOf(pOk), n = s.length, mf = pOk.raw && pOk.raw.meta;
    check('תמונה אמיתית מדומה: כל הפריימים src=photo, התוצאה תקינה, מספר פריימים כמו בווידאו', okRes(pOk) && n >= 20 && cnt(s, 'photo') === n && pOk.r.meta.src === n + '/' + n, { n, src: pOk.r.meta && pOk.r.meta.src, err: pOk.r && pOk.r.err });
    check('תמונה אמיתית: כיול FOV נשמר תחת המפתח של התמונות בלבד (-ph)', pOk.ls.ph && Math.abs(+pOk.ls.ph - 62) <= 2.5 && !pOk.ls.v, pOk.ls);
    check('נעילות נתמכות: נשלחו exposure/whiteBalance/focus ידניים עם הערכים הנוכחיים, נרשמו ב-meta (lock) לפני הצילום הראשון', mf && mf.lock && mf.lock.exp && mf.lock.wb && mf.lock.focus && pOk.applied.length === 3 && pOk.applied[0].advanced[0].exposureMode === 'manual' && pOk.applied[0].advanced[0].exposureTime === 166 && pOk.applied[1].advanced[0].colorTemperature === 5200 && pOk.applied[2].advanced[0].focusDistance === 0.4 && pOk.r.meta.lock && pOk.r.meta.lock.exp, { lock: mf && mf.lock, applied: pOk.applied.length });
    check('HDR כבוי (21ו): פריים אחד לכל יעד, בלי g/ev, hdr.mode=off; צילום חוזר לטשטוש רק לעתים רחוקות בצילום חד (≤3 – לפי התוכן, ראו הדוח) וכל אחד = קריאה אחת נוספת', mf && mf.frames.every((f) => f.g === undefined && f.ev === undefined) && mf.hdr && mf.hdr.mode === 'off' && mf.blur && mf.blur.retakes <= 3 && pOk.calls === mf.frames.length + mf.blur.retakes, { hdr: mf && mf.hdr, blur: mf && mf.blur, calls: pOk.calls });
    check('meta.json: src לכל פריים, photo.max=1600', mf && mf.frames.every((f) => f.src === 'photo' && Math.max(f.w, f.h) <= 1600) && mf.photo && mf.photo.max === 1600 && !mf.photo.off, mf && mf.photo); }
  const pNone = await phRun('caps none', { photo: 'ok', caps: 'none' }, 5);
  check('נעילות לא נתמכות: ממשיכים בלי נעילה (lock כולו false, אף applyConstraints), הצילום תקין', okRes(pNone, true) && pNone.applied.length === 0 && pNone.raw.meta.lock && !pNone.raw.meta.lock.exp && !pNone.raw.meta.lock.wb && !pNone.raw.meta.lock.focus, { lock: pNone.raw && pNone.raw.meta.lock, applied: pNone.applied.length });
  const pFx = await phRun('lock exp fails', { photo: 'ok', caps: 'failexp' }, 5);
  check('נעילת חשיפה נכשלת: ממשיכים (wb ו-focus כן ננעלו), הצילום תקין', okRes(pFx, true) && pFx.raw.meta.lock && !pFx.raw.meta.lock.exp && pFx.raw.meta.lock.wb && pFx.raw.meta.lock.focus, pFx.raw && pFx.raw.meta.lock);
  const pFail = await phRun('photo fail', { photo: 'fail' }, 5);
  { const s = srcOf(pFail);
    check('takePhoto נכשל פעמיים: חזרה לפריימים מהווידאו (כולם src=video), 2 ניסיונות בלבד, התוצאה תקינה, הכיול במפתח הרגיל', okRes(pFail, true) && s.length >= 4 && cnt(s, 'video') === s.length && pFail.calls === 2 && pFail.raw.meta.photo.off && pFail.ls.v && !pFail.ls.ph, { calls: pFail.calls, src: pFail.r.meta && pFail.r.meta.src, ls: pFail.ls }); }
  const pOnce = await phRun('photo failonce', { photo: 'failonce' }, 5);
  { const s = srcOf(pOnce);
    check('כשלון אחד בלבד: מנסים שוב ונשארים בתמונות (כולן photo)', okRes(pOnce, true) && cnt(s, 'photo') === s.length && s.length >= 4 && pOnce.raw.meta.photo.fails === 1, { n: s.length, fails: pOnce.raw && pOnce.raw.meta.photo }); }
  for (const kind of ['cw', 'ccw']) {
    const pr = await phRun('rot ' + kind, { photo: kind }, 5); const s = srcOf(pr);
    check('תמונה מסובבת (' + kind + '): מוחזרת לכיוון התצוגה לפי דמיון לווידאו, כל הפריימים photo והתמונה המחוברת תואמת לסצנה', okRes(pr, true) && s.length >= 4 && cnt(s, 'photo') === s.length && pr.raw.meta.frames.every((f) => f.h > f.w), { n: s.length, err: pr.r && pr.r.err });
  }
  const pMv = await phRun('photo move', { photo: 'move' }, 5); { const s = srcOf(pMv);
    check('הטלפון זז בזמן התמונה הראשונה: התמונה נזרקת ומצולמת מחדש (יותר קריאות takePhoto מפריימים), בלי חזרה לווידאו', okRes(pMv, true) && cnt(s, 'photo') === s.length && pMv.calls > s.length && pMv.raw.meta.photo.fails === 0 && !pMv.raw.meta.photo.off, { calls: pMv.calls, n: s.length }); }
  const pVid = await phRun('no photo api', {}, 5);
  check('בלי ImageCapture (mock.photo חסר): כמו קודם – כולם video, בלי נעילות (אין track)', okRes(pVid, true) && cnt(srcOf(pVid), 'video') === srcOf(pVid).length && !pVid.raw.meta.photo.avail, { photo: pVid.raw && pVid.raw.meta.photo });

  /* ---------- 6. שלב 21ו: HDR (3 חשיפות לכל יעד) וצילום חוזר לתמונה מטושטשת ---------- */
  const frOf = (q) => (q.raw && q.raw.meta ? q.raw.meta.frames : []);
  const pH = await phRun('hdr time', { photo: 'ok', caps: 'full', hdr: 1, floor: 'shoot' });
  { const fr = frOf(pH), mf = pH.raw && pH.raw.meta, main = fr.filter((f) => f.ev === 0), nad = fr.filter((f) => f.role === 'nadir');
    const grpOk = main.length > 0 && main.every((f) => { const g = fr.filter((x) => x.g === f.g); return g.length === 3 && g.map((x) => x.ev).join() === '0,-1,1' && g.every((x) => JSON.stringify(x.q) === JSON.stringify(f.q) && x.ti === f.ti && x.g === x.ti); });
    check('HDR (זמן חשיפה): לכל יעד 3 פריימים (g = היעד, ev 0,-1,1, אותו q), hdr.mode=time ו-factors ¼/1/4; רצפה – פריים אחד בלי g; חיבור JS רק מ-ev=0 (השגיאה כרגיל)',
      okRes(pH) && main.length >= 20 && grpOk && fr.length === main.length * 3 + 1 && nad.length === 1 && nad[0].g === undefined && nad[0].ev === undefined && mf.hdr.mode === 'time' && JSON.stringify(mf.hdr.factors) === '[0.25,1,4]' && pH.r.meta.hdr === 'time',
      { n: fr.length, main: main.length, hdr: mf && mf.hdr, err: pH.r && pH.r.err });
    const rt = mf ? mf.blur.retakes : -1, nb = main.length + rt; /* סדרה שנזרקה בגלל טשטוש – גם היא 3 חשיפות */
    const ts = pH.shots.map((s) => s.t), tri = ts.slice(0, -1), pat = tri.every((t, i) => t === [166, 41.5, 664][i % 3]);
    const restore = pH.applied.filter((a) => a.advanced[0].exposureTime === 166).length;
    check('HDR: סדר החשיפות בכל סדרה – רגילה 166, כהה 41.5, בהירה 664; אחרי כל סדרה חזרה ל-166; הרצפה – תמונה אחת בחשיפה הרגילה', pat && ts.length === nb * 3 + 1 && ts[ts.length - 1] === 166 && restore === nb + 1 && pH.exp.t === 166, { first: ts.slice(0, 7), n: ts.length, retakes: rt, restore, exp: pH.exp });
    check('HDR: ההנחיה "מצלם 3 חשיפות… החזיקו יציב" הוצגה', pH.hints.includes('מצלם 3 חשיפות… החזיקו יציב'), pH.hints.slice(0, 12)); }
  const pC = await phRun('hdr comp', { photo: 'ok', caps: 'comp', hdr: 1 }, 5);
  { const fr = frOf(pC), mf = pC.raw && pC.raw.meta, cs = pC.shots.map((s) => s.c);
    check('HDR (פיצוי חשיפה, בלי נעילה ידנית): ‎−2/0/+2, החזרה ל-0, hdr.mode=comp', okRes(pC, true) && mf.hdr.mode === 'comp' && JSON.stringify(mf.hdr.factors) === '[-2,0,2]' && !mf.lock.exp && cs.slice(0, 6).join() === '0,-2,2,0,-2,2' && pC.exp.c === 0 && fr.filter((f) => f.ev === 0).length * 3 === fr.length, { hdr: mf && mf.hdr, cs: cs.slice(0, 9), exp: pC.exp }); }
  const pF = await phRun('hdr apply fails', { photo: 'ok', caps: 'failhdr', hdr: 1 }, 5);
  { const fr = frOf(pF), mf = pF.raw && pF.raw.meta;
    check('HDR: שינוי חשיפה נכשל – ממשיכים בתמונה אחת ליעד (בלי ev ‎±1), hdr.bad, התוצאה תקינה', okRes(pF, true) && mf.hdr.bad === true && fr.length >= 5 && fr.every((f) => !f.ev) && pF.exp.t === 166, { hdr: mf && mf.hdr, n: fr.length, evs: fr.map((f) => f.ev).join() }); }
  const pB = await phRun('blur once', { photo: 'ok', caps: 'full', hdr: 0, blurAt: [6] }, 8);
  { const fr = frOf(pB), mf = pB.raw && pB.raw.meta;
    check('טשטוש: התמונה ה-6 מטושטשת – נזרקת ומצולמת שוב אוטומטית (קריאה אחת נוספת), הנחיה בעברית, blur.retakes=1', okRes(pB, true) && mf.blur.retakes === 1 && pB.calls === fr.length + 1 && pB.hints.includes('התמונה יצאה מטושטשת – מצלם שוב') && fr.every((f) => f.sh > 0), { calls: pB.calls, n: fr.length, blur: mf && mf.blur, sh: fr.map((f) => f.sh).slice(0, 8) }); }
  const pB2 = await phRun('blur twice', { photo: 'ok', caps: 'full', hdr: 0, blurAt: [6, 7] }, 8);
  { const fr = frOf(pB2), mf = pB2.raw && pB2.raw.meta, sh = fr.map((f) => f.sh), lo = sh.filter((v) => v < 0.5 * Math.max(...sh));
    check('טשטוש: גם הצילום החוזר מטושטש – מתקבל (צילום חוזר אחד בלבד ליעד)', okRes(pB2, true) && mf.blur.retakes === 1 && pB2.calls === fr.length + 1 && lo.length === 1, { calls: pB2.calls, n: fr.length, sh }); }
  { const p = await open();
    await p.evaluate(() => { window.__res = undefined; window.__run({ mode: 'pts', photo: 'ok', caps: 'full', hdr: 1 }).then((r) => (window.__res = r || 'null')); });
    await p.waitForFunction(() => { const c = document.querySelector('.s3pc-cnt'); return c && /צולמו [1-9]/.test(c.textContent); }, null, { timeout: 60000 });
    const b0 = await p.evaluate(() => { const b = document.querySelector('[data-k=hdr]'), r = b.getBoundingClientRect(); return { vis: !b.hidden && r.height >= 40, pr: b.getAttribute('aria-pressed'), t: b.textContent, h: Math.round(r.height), cnt: document.querySelector('.s3pc-cnt').textContent, over: document.documentElement.scrollWidth > innerWidth }; });
    await p.click('[data-k=hdr]');
    const b1 = await p.evaluate(() => ({ pr: document.querySelector('[data-k=hdr]').getAttribute('aria-pressed'), ls: localStorage.getItem('lp-s3pc-hdr') }));
    await p.screenshot({ path: shot.replace(/\.png$/, '') + '-hdr.png' });
    await p.evaluate(() => S3PanoCap.close()); await p.close();
    const m = /צולמו (\d+) מתוך (\d+)/.exec(b0.cnt);
    check('כפתור HDR: מוצג (גובה 40 לפחות), פעיל כברירת מחדל; לחיצה מכבה ונשמר ב-localStorage; המונה סופר יעדים (לא חשיפות); בלי גלישה', b0.vis && b0.pr === 'true' && b0.t === 'HDR' && b1.pr === 'false' && b1.ls === '0' && m && +m[1] <= +m[2] && !b0.over, { b0, b1 }); }
  { const p = await open();
    await p.evaluate(() => { window.__run({ mode: 'pts', photo: 'ok', caps: 'none', hdr: 1 }); });
    await p.waitForFunction(() => { const c = document.querySelector('.s3pc-cnt'); return c && /צולמו/.test(c.textContent); }, null, { timeout: 60000 });
    const hid = await p.evaluate(() => document.querySelector('[data-k=hdr]').hidden);
    await p.evaluate(() => S3PanoCap.close()); await p.close();
    check('כפתור HDR מוסתר כשאין שליטה בחשיפה', hid === true, hid); }

  check('אין שגיאות JS', errors.length === 0, errors.slice(0, 5));
  await browser.close(); srv.close();
  const fail = R.checks.filter((c) => !c.ok).length;
  if (outJson) fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(fail ? `נכשלו ${fail} בדיקות` : `כל ${R.checks.length} הבדיקות עברו`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
