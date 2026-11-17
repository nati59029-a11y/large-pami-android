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
      window.__natCalls++; window.__natArgs = { n: frames.length, W: o.W, yawRef: o.yawRef, fovL: o.fovL, q: frames.every((f) => f.q && f.q.length === 4 && f.blob), roles: frames.map((f) => f.role), gs: frames.map((f) => f.g), evs: frames.map((f) => f.ev) };
      onP(0.5);
      if (kind === 'fail') return setTimeout(() => rej(new Error('oom')), 50);
      const c = document.createElement('canvas'); c.width = o.W; c.height = o.W / 2; const g = c.getContext('2d'); g.fillStyle = '#c03020'; g.fillRect(0, 0, c.width, c.height);
      c.toBlob((b) => (window.__natBytes = b.size, res({ full: b, fovL: 61.5, stats: { pairs: 9, inlierPairs: 8, rmsDeg: 0.05 } })), 'image/jpeg', 0.92);
    }),
  };
};
let fails = 0;
const check = (name, ok, ev) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' – ' + JSON.stringify(ev)); };
(async () => {
  /* S3PanoNative (Node, Capacitor מדומה): role עובר ל-addFrame רק כשהוא מוגדר */
  {
    const added = [], P = { isAvailable: async () => ({ ok: true }), begin: async () => ({}), addListener: async () => ({ remove: async () => {} }), cancel: async () => {},
      addFrame: async (a) => { added.push(a); return {}; }, run: async () => ({ jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'), fovL: 60, stats: {} }) };
    const N = require('../store3d-pano-native.js')({ Capacitor: { Plugins: { PanoStitch: P } }, btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'), Blob });
    const fr = (role) => Object.assign({ blob: new Blob([Buffer.from([1, 2, 3])]), q: [1, 0, 0, 0], w: 4, h: 3, yaw: 0 }, role === undefined ? {} : { role });
    await N.stitch([fr(), fr(), fr('nadir')], { fovL: 60, W: 2048 });
    check('native.js: addFrame מקבל role רק כשהוא מוגדר (הפריים האחרון nadir, האחרים בלי המפתח)', added.length === 3 && !('role' in added[0]) && !('role' in added[1]) && added[2].role === 'nadir' && added[2].i === 2, added.map((a) => ({ i: a.i, role: a.role, has: 'role' in a })));
    /* שלב 21ו: g ו-ev עוברים כשהם מוגדרים (גם g=0 ו-ev=0), ולא נשלחים כשאין */
    added.length = 0;
    await N.stitch([Object.assign(fr(), { g: 0, ev: 0 }), Object.assign(fr(), { g: 0, ev: -1 }), Object.assign(fr(), { g: 0, ev: 1 }), Object.assign(fr(), { g: 5, ev: 0 }), fr(), fr('nadir')], { fovL: 60, W: 8192 });
    check('native.js (21ו): addFrame מקבל g ו-ev כשהם מוגדרים (כולל 0), בלי המפתחות בפריים בלי קבוצה ובפריים הרצפה', added.length === 6 && added.slice(0, 4).map((a) => a.g + '/' + a.ev).join() === '0/0,0/-1,0/1,5/0' && !('g' in added[4]) && !('ev' in added[4]) && !('g' in added[5]) && added[5].role === 'nadir', added.map((a) => ({ i: a.i, g: a.g, ev: a.ev, role: a.role })));
  }
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true, locale: 'he-IL' });
  for (const kind of ['ok', 'fail', 'none', 'hdr', 'w8k', 'mem4']) {
    const p = await ctx.newPage(), errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(MOCK, kind);
    if (kind === 'mem4') await p.addInitScript(() => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 4, configurable: true }));
    await p.goto(base + '/store3d-dev/pano-cap.html', { waitUntil: 'load' });
    await p.waitForFunction(() => window.__run && window.S3PanoCap);
    /* שלב 21ו: hdr – תמונות אמיתיות מדומות עם HDR; w8k / mem4 – בלי width (הרוחב נבחר לפי הזיכרון ו-maxTex) */
    const ro = kind === 'hdr' ? { width: 2048, floor: 'shoot', mode: 'pts', photo: 'ok', caps: 'full', hdr: 1 } : kind === 'w8k' || kind === 'mem4' ? { floor: 'skip', mode: 'pts', hdr: 0 } : { width: 2048, floor: kind === 'none' ? 'skip' : 'shoot' };
    await p.evaluate((o) => { window.__run(o).then((r) => (window.__res = r || 'null'), (e) => (window.__res = 'err:' + e.message)); }, ro);
    await p.waitForFunction(() => window.__res, null, { timeout: 300000 });
    const r = await p.evaluate(() => ({ res: window.__res, calls: window.__natCalls, args: window.__natArgs, natBytes: window.__natBytes }));
    const m = r.res && r.res.meta || {};
    if (kind === 'ok') {
      check('תוסף תקין: התוצאה מהתוסף, 2048×1024, קטנה 1024×512, fovL מהתוסף, הפריימים הועברו עם כיוון', r.calls === 1 && m.engine === 'native' && r.res.full.w === 2048 && r.res.full.h === 1024 && r.res.sm.w === 1024 && m.fovL === 61.5 && r.args.W === 2048 && r.args.q && r.args.n === m.n && m.n === r.args.roles.length && r.args.roles.slice(0, -1).every((x) => x === undefined) && r.args.roles[r.args.roles.length - 1] === 'nadir', { meta: m, args: r.args, full: r.res.full, sm: r.res.sm });
    } else if (kind === 'fail') {
      check('תוסף נכשל: חוזרים לחיבור ב-JS ומקבלים תמונה תקינה', r.calls === 1 && m.engine === 'js' && r.res.full.w === 2048 && r.res.err < 40, { engine: m.engine, err: r.res.err });
    } else if (kind === 'hdr') {
      const a = r.args || {}, n = a.n || 0, ev0 = (a.evs || []).filter((x) => x === 0).length;
      const grp = (a.gs || []).slice(0, -1).every((g, i) => Number.isInteger(g) && g === a.gs[i - (i % 3)] && (i % 3 || i === 0 || g !== a.gs[i - 1])) && (a.evs || []).slice(0, -1).every((e, i) => e === [0, -1, 1][i % 3]);
      check('HDR לתוסף: כל החשיפות נשלחות (3 לכל יעד + רצפה), עם g ו-ev; הרצפה בלי g; התוצאה מהתוסף', r.calls === 1 && m.engine === 'native' && m.hdr === 'time' && ev0 >= 20 && n === ev0 * 3 + 1 && grp && a.gs[n - 1] === undefined && a.roles[n - 1] === 'nadir' && r.res.full.w === 2048, { n, ev0, gs: (a.gs || []).slice(0, 7), evs: (a.evs || []).slice(0, 7), meta: m.hdr });
    } else if (kind === 'w8k' || kind === 'mem4') {
      const W = kind === 'w8k' ? 8192 : 4096;
      check('רוחב התוצאה בתוסף (21ו): ' + (kind === 'w8k' ? 'זיכרון לא ידוע / 6 ומעלה ⇒ 8192' : 'deviceMemory=4 ⇒ 4096') + ', ה-JPEG של התוסף נשמר כמו שהוא, קטנה 1024×512', r.calls === 1 && m.engine === 'native' && r.args.W === W && r.res.w === W && r.res.full.w === W && r.res.full.h === W / 2 && r.res.sm.w === 1024 && r.res.fullBytes === r.natBytes, { bytes: [r.res.fullBytes, r.natBytes], W: r.args && r.args.W, full: r.res.full, sm: r.res.sm, dm: await p.evaluate(() => navigator.deviceMemory) });
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
