'use strict';
// בדיקת דפדפן לשלב 9 (תלת מימד מציאותי + מצב מיני). כל הטקסטורות נוצרות בקוד דף הבדיקה (real.html), לא נכנסות לאפליקציה.
// הרצה: node app-source/www/store3d-dev/check9.js <צילום-רגיל.png> <צילום-מיני.png> [תוצאות.json] [צילום-מלמעלה.png]   (דורש playwright + Chromium)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const [shotN, shotM, out, shotT] = [process.argv[2] || 'store3d9-360.png', process.argv[3] || 'store3d9-mini-360.png', process.argv[4], process.argv[5]];
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
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, hasTouch: true, locale: 'he-IL' });
  const R = { checks: [] }, errors = [], reqs = [];
  const check = (name, ok, ev) => { R.checks.push({ name, ok: !!ok, ev }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' – ' + (typeof ev === 'string' ? ev : JSON.stringify(ev))); };
  const watch = (page) => { page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); page.on('request', (r) => reqs.push(r.url())); };

  /* ---------- 1. מצב רגיל: 300 גופים, טקסטורות ותמונות ---------- */
  const page = await ctx.newPage(); watch(page);
  await page.goto(base + '/store3d-dev/real.html?n=300', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__h, null, { timeout: 30000 });
  await page.waitForFunction(() => { const s = window.__h.stats(); return s.tex.ok + s.tex.fail >= 4 && s.photos.ok + s.photos.fail >= s.photos.want; }, null, { timeout: 400000 });
  const s1 = await page.evaluate(() => window.__h.stats());
  R.normal = s1;
  check('300 גופים עם טקסטורות ותמונות נטענו בלי קריסה', s1.fx >= 300 && s1.tex.ok === 4 && s1.photos.ok === s1.photos.want && s1.photos.fail === 0,
    `${s1.fx} גופים, ${s1.bays} מקטעים · טקסטורות ${s1.tex.ok}/4 · תמונות ${s1.photos.ok}/${s1.photos.want} בתא ${s1.photos.cell}px ב-${s1.photos.atlases} אטלסים · בנייה ${s1.buildMs}ms`);
  const exp = await page.evaluate(() => { const c = { ok: 0, iss: 0, miss: 0, rev: 0, out: 0 }; for (const k in window.__sum.b) c[window.__sum.b[k].s]++; return c; });
  check('צבעי מצב: מספר המקטעים בכל מצב תואם ל-s3sum', JSON.stringify(exp) === JSON.stringify(s1.stat), JSON.stringify(s1.stat));
  const leg = await page.evaluate(() => { const l = document.querySelector('.s3d-legend'); return l ? l.innerText.replace(/\s+/g, ' ') : ''; });
  check('מקרא בעברית עם 5 המצבים', ['תקין', 'בעיה', 'לא צולם', 'לבדיקה', 'לא בסבב'].every((t) => leg.includes(t)), leg);
  await page.evaluate(() => window.__dsReady);
  // סימון מצב: פס דק + תג עם סמל (במקום מסגרת). הצבעים נקראים מ-Store3D.STAT (מקום אחד), לא כתובים כאן
  const pal = await page.evaluate(() => Object.fromEntries(Object.entries(Store3D.STAT).map(([k, v]) => [k, [v.c >> 16, (v.c >> 8) & 255, v.c & 255]])));
  const symOk = await page.evaluate(() => { const S = Store3D.STAT; return S.ok.y === '✓' && S.iss.y === '!' && S.miss.y === '✕' && S.rev.y === '?' && !S.out.y; });
  check('תגים עם סמל לכל מצב (✓ ! ✕ ?), ול"לא בסבב" אין תג', symOk && s1.badges && s1.badges.ok === exp.ok && s1.badges.iss === exp.iss && s1.badges.miss === exp.miss && s1.badges.rev === exp.rev && !('out' in s1.badges && s1.badges.out), JSON.stringify(s1.badges));
  // ניגודיות (WCAG, חישוב עצמאי): צבע המצב מול מדף לבן ≥3, סמל מול צבע התג ≥3.5; "לבדיקה" סגול (כחול < אדום)
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }, lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const fg = await page.evaluate(() => Object.fromEntries(Object.entries(Store3D.STAT).map(([k, v]) => [k, [v.f >> 16, (v.f >> 8) & 255, v.f & 255]])));
  const crs = Object.fromEntries(Object.keys(pal).map((k) => [k, { shelf: +cr(pal[k], [238, 240, 242]).toFixed(2), sym: k === 'out' ? null : +cr(pal[k], fg[k]).toFixed(2) }]));
  check('פלטה נגישה: מול מדף לבן ≥3:1, סמל מול התג ≥3.5:1, "לבדיקה" בסגול', Object.values(crs).every((c) => c.shelf >= 3 && (c.sym === null || c.sym >= 3.5)) && pal.rev[0] > pal.rev[1] && pal.rev[2] > pal.rev[1] && pal.rev[0] > 90, crs);
  const near = (r, G, b, c) => Math.abs(r - c[0]) < 14 && Math.abs(G - c[1]) < 14 && Math.abs(b - c[2]) < 14;
  const shot = () => page.evaluate(() => { window.__h.renderNow(); const g = document.querySelector('#view canvas'); const c = document.createElement('canvas'); c.width = g.width; c.height = g.height; const x = c.getContext('2d'); x.drawImage(g, 0, 0); return Array.from(x.getImageData(0, 0, c.width, c.height).data); });
  const count = (d) => { const o = { ok: 0, iss: 0, miss: 0, rev: 0, out: 0 }; for (let i = 0; i < d.length; i += 4) for (const k in o) if (near(d[i], d[i + 1], d[i + 2], pal[k])) { o[k]++; break; } return o; };
  await page.evaluate(() => { window.__h.setMode('top'); window.__h.renderNow(); });
  const px = count(await shot());
  check('סימוני המצב מופיעים בפועל בתמונה (מבט מלמעלה)', px.ok > 50 && px.iss > 10 && px.miss > 10 && px.rev > 3 && px.out > 3, px);
  const bpx = s1.badgePx; await page.evaluate(() => window.__h.setMode('walk')); const wpx = (await page.evaluate(() => window.__h.stats())).badgePx; await page.evaluate(() => window.__h.setMode('top'));
  check('התגים בגודל קבוע במסך: קטנים מלמעלה, גדולים יותר בהליכה', bpx >= 10 && bpx <= 14 && wpx >= 18 && wpx <= 24, `מלמעלה ${bpx}px · הליכה ${wpx}px (תקין; שאר המצבים +2–3px)`);
  // כפתור הסתרת סימונים: מסתיר גם פסים וגם תגים
  await page.click('.s3d-frames'); const f0 = await page.evaluate(() => window.__h.stats().framesOn);
  await page.evaluate(() => window.__h.renderNow()); const px0 = count(await shot());
  await page.click('.s3d-frames'); const f1 = await page.evaluate(() => window.__h.stats().framesOn);
  check('כפתור "הסתר סימונים" מסתיר ומחזיר (פסים ותגים)', f0 === false && f1 === true && px0.rev < px.rev / 4 && px0.miss < px.miss / 4, `אחרי לחיצה: ${f0} (סגול ${px0.rev}, אדום ${px0.miss}), אחרי שנייה: ${f1}`);
  // מקרא וכפתור בעיצוב האפליקציה: טוקני ds מ-index.html, כפתור "btn s g", בלי צבעים קשיחים
  const lg = await page.evaluate(() => {
    const l = document.querySelector('.s3d-legend'), b = l.querySelector('.s3d-frames'), cs = getComputedStyle(l), bs = getComputedStyle(b), r = getComputedStyle(document.documentElement), v = (k) => r.getPropertyValue('--' + k).trim();
    const norm = (c) => { const d = document.createElement('i'); d.style.color = c; document.body.appendChild(d); const o = getComputedStyle(d).color; d.remove(); return o; };
    const inl = [l, ...l.querySelectorAll('*')].map((e) => e.getAttribute('style') || '').join(' ');
    return { app: !!document.getElementById('app-css'), ds: document.documentElement.dataset.ds, bg: cs.backgroundColor === norm(v('glass')), ink: cs.color === norm(v('ink')), line: cs.borderTopColor === norm(v('line')), rad: cs.borderTopLeftRadius === v('r-m'),
      btnCls: b.className, btnAcc: bs.color === norm(v('acc')), btnH: b.getBoundingClientRect().height, hard: /#[0-9a-f]{3,8}\b|rgba?\(/i.test(inl), badges: l.querySelectorAll('canvas').length, txt: b.textContent };
  });
  check('מקרא וכפתור בעיצוב האפליקציה (טוקני ds, btn s g, בלי צבעים קשיחים)', lg.app && lg.bg && lg.ink && lg.line && lg.rad && /\bbtn\b/.test(lg.btnCls) && /\bg\b/.test(lg.btnCls) && lg.btnAcc && !lg.hard && lg.badges === 5 && lg.btnH >= 40, lg);
  // חיפוש מהבהב
  const sr = await page.evaluate(() => { const r = window.__h.search('12'); return { r, s: window.__h.stats() }; });
  check('חיפוש לפי מספר גוף מוצא ומהבהב', sr.r.length >= 1 && sr.s.blink, JSON.stringify(sr.r.slice(0, 3)) + ' blink=' + sr.s.blink);
  await page.evaluate(() => window.__h.blink(null));
  // FPS (ציור רצוף) – SwiftShader, מעבד בלבד
  const fps = await page.evaluate(async () => { const h = window.__h, o = {}; for (const m of ['top', 'walk']) { h.setMode(m); h.renderNow(); const t0 = performance.now(); let n = 0; while (performance.now() - t0 < 2500) { h.renderNow(); n++; } o[m] = +(n / ((performance.now() - t0) / 1000)).toFixed(1); } o.st = h.stats(); return o; });
  R.fps = fps;
  check('קצב ציור נמדד (דפדפן שולחני, SwiftShader – לא מאומת בטלפון)', fps.top > 0 && fps.walk > 0, `מלמעלה ${fps.top} FPS · הליכה ${fps.walk} FPS · ${fps.st.calls} קריאות ציור · ${fps.st.tris} משולשים`);
  // הקשה על הרצפה במבט הליכה מזיזה אליה
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await page.evaluate(() => window.__h.setMode('walk'));
  await sleep(300);
  const w0 = (await page.evaluate(() => window.__h.stats())).walk;
  let moved = null;
  for (const [x, y] of [[180, 600], [180, 560], [120, 600], [240, 600], [180, 520]]) {
    await touch('touchStart', [[x, y]]); await touch('touchEnd', []); await sleep(1900);
    const w1 = (await page.evaluate(() => window.__h.stats())).walk;
    if (Math.hypot(w1[0] - w0[0], w1[1] - w0[1]) > 0.2) { moved = { at: [x, y], from: w0, to: w1 }; break; }
  }
  check('הקשה על נקודה ברצפה (הליכה) מזיזה אליה', !!moved, moved || 'לא זז');
  const inside = await page.evaluate(() => { const s = window.__h.stats(), m = S3G.buildModel(window.__map); return S3G.inAnyRoom(m, s.walk[0] * 100, s.walk[1] * 100); });
  check('אחרי התנועה עדיין בתוך החנות', inside, String(inside));
  // צילום מצב רגיל: מבט הליכה מול מדפים עם תמונות
  await page.evaluate(() => { const h = window.__h, m = S3G.buildModel(window.__map); const f = m.fx.find((x) => x.k === 'gon' && x.bayList.every((b) => window.__sum.b[b.id] && window.__sum.b[b.id].th)); h.focus(f.id); });
  for (let k = 0; k < 5; k++) { await page.mouse.move(180, 300); await page.mouse.wheel(0, 100); await sleep(250); } // גלגלת אחורה = צעד אחורה
  await page.mouse.move(180, 300); await page.mouse.down(); await page.mouse.move(-20, 300, { steps: 6 }); await page.mouse.up(); // סיבוב לאורך המעבר
  await sleep(1500);
  const s2 = await page.evaluate(() => window.__h.stats());
  check('תמונות חדות למקטעים קרובים במבט הליכה (עד 6)', s2.photos.hi >= 1 && s2.photos.hi <= 6, 'קרובים: ' + s2.photos.hi);
  await page.screenshot({ path: shotN });
  check('צילום 360px – מצב רגיל (הליכה)', fs.existsSync(shotN), shotN);
  if (shotT) { await page.evaluate(() => { const h = window.__h; h.setMode('top'); document.getElementById('top').click(); }); await sleep(600); await page.screenshot({ path: shotT }); check('צילום 360px – מבט מלמעלה', fs.existsSync(shotT), shotT); }
  const gone = await page.evaluate(() => { window.__h.destroy(); return !document.querySelector('#view canvas') && !document.querySelector('.s3d-legend'); });
  check('destroy משחרר ומסיר קנבס ומקרא', gone, String(gone));
  await page.close();

  /* ---------- 2. מצב מיני ---------- */
  const p2 = await ctx.newPage(); watch(p2);
  const r0 = reqs.length;
  await p2.goto(base + '/store3d-dev/real.html?n=40&mini=1&keep=1500', { waitUntil: 'load' });
  await sleep(800);
  const m0 = await p2.evaluate(() => ({ st: window.__m.stats(), canvas: !!document.querySelector('#mini canvas'), loads: window.__loads.length }));
  check('מיני: לא נטען לפני שהחלון נראה במסך', !m0.st.open && !m0.canvas && m0.loads === 0, m0);
  await p2.evaluate(() => document.getElementById('card').scrollIntoView({ block: 'center' }));
  await p2.waitForFunction(() => window.__m.stats().open && document.querySelector('#mini canvas'), null, { timeout: 30000 });
  await p2.waitForFunction(() => { const v = window.__m.stats().view; return v && v.tex.ok + v.tex.fail >= 4 && v.photos.ok + v.photos.fail >= v.photos.want; }, null, { timeout: 60000 });
  const c1 = await p2.evaluate(() => window.__m.stats().view);
  await sleep(1500);
  const c2 = await p2.evaluate(() => window.__m.stats().view);
  R.mini = c2;
  check('מיני: אותו מנוע, טקסטורות ותמונות, רזולוציה מוקטנת', c2.mini && c2.tex.ok === 4 && c2.photos.ok === c2.photos.want && c2.px <= 1 && c2.photos.cell <= 64, `px=${c2.px} · תא ${c2.photos.cell}px · תמונות ${c2.photos.ok}/${c2.photos.want} · טקסטורות ${c2.tex.ok}`);
  const fpsM = (c2.frames - c1.frames) / 1.5;
  check('מיני: מסתובב לאט (המצלמה זזה), עד ~24 פריימים בשנייה', JSON.stringify(c1.cam) !== JSON.stringify(c2.cam) && fpsM <= 26, `${c1.cam} -> ${c2.cam} · ${fpsM.toFixed(1)} פריימים בשנייה`);
  await (await p2.$('#card')).screenshot({ path: shotM });
  check('צילום 360px – מצב מיני', fs.existsSync(shotM), shotM);
  await p2.evaluate(() => window.scrollTo(0, 0)); await sleep(500);
  const m1 = await p2.evaluate(() => window.__m.stats());
  check('מיני: נעצר כשיוצא מהמסך', m1.view && m1.view.paused, JSON.stringify({ open: m1.open, paused: m1.view && m1.view.paused }));
  await sleep(1800);
  const m2 = await p2.evaluate(() => ({ st: window.__m.stats(), canvas: !!document.querySelector('#mini canvas') }));
  check('מיני: משחרר זיכרון (dispose) אחרי זמן מחוץ למסך', !m2.st.open && !m2.canvas, m2);
  const L1 = await p2.evaluate(() => window.__loads.length);
  await p2.evaluate(() => document.getElementById('card').scrollIntoView({ block: 'center' }));
  await p2.waitForFunction(() => window.__m.stats().open, null, { timeout: 30000 });
  await sleep(600);
  const L2 = await p2.evaluate(() => window.__loads.length);
  check('מיני: חוזר כשחוזרים למסך, בלי להוריד שוב את התמונות (מטמון)', L2 === L1, `הורדות לפני: ${L1}, אחרי: ${L2}`);
  await p2.evaluate(() => document.getElementById('mini').remove()); await sleep(2600);
  const m3 = await p2.evaluate(() => window.__m.stats());
  check('מיני: משתחרר כשהאלמנט הוסר מהדף', m3.dead && !m3.open, m3);
  check('אין בקשות לרשת חיצונית', reqs.every((u) => u.startsWith(base)), reqs.filter((u) => !u.startsWith(base)).join(',') || 'הכל מקומי');
  check('אין שגיאות JS', errors.length === 0, errors.join(' | ') || 'אין');
  R.errors = errors;
  if (out) fs.writeFileSync(out, JSON.stringify(R, null, 1));
  await browser.close(); srv.close();
  process.exit(R.checks.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
