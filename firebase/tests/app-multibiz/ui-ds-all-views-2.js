'use strict';
// עיצוב מחדש D5-2: מסכי תפעול, ניהול ומזכירה × שלוש ערכות. רשת מדומה (לא צריך אמולטור).
// בדיקות: בלי שגיאת JS/קונסול, בלי גלילה אופקית ב-360, ניגודיות טקסט ≥4.5, בלי אימוג'י-אייקון, מתג "ניגודיות גבוהה".
// שימוש: node ui-ds-all-views-2.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 700) : '')); };
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders', 'secretary'].map((k) => [k, true]));
// [שם, קוד פתיחה]. מסכי הצילום ב-SHOT מצולמים גם בערכות ב וג
const VIEWS = [
  ['settings', "go('settings')"], ['data', "go('data')"], ['sync', "go('sync')"],
  ['shelf', "go('shelf')"], ['shAdd', "go('shAdd')"], ['shPromo', "go('shPromo')"], ['shDrafts', "go('shDrafts')"], ['shImp', "go('shImp')"],
  ['fb', "go('fb')"], ['fbcap', "go('fbcap')"], ['fbRev', "go('fbRev')"], ['fbTab', "go('fbTab')"], ['fbGraph', "go('fbGraph')"],
  ['tk', "go('tk')"], ['ar', "go('ar')"], ['zc', "go('zc')"], ['dp', "go('dp')"], ['zs', "go('zs')"],
  ['org', "go('org')"], ['sa', "go('sa')"], ['staff', "go('staff')"], ['brand', "go('brand','b1')"], ['mq', "go('mq')"], ['rq', "go('rq')"],
  ['sec', "go('sec')"], ['yl', "go('yl')"],
];
const SHOT = new Set(['settings', 'sync', 'fb', 'tk', 'staff', 'sec']);
const EMO = /[\u{1F000}-\u{1FAFF}\u2600-\u2712\u2715-\u27BF⬀-⯿❓❗️]/u;
const BR = `(() => {
  const P = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return [0, 0, 0, 0]; const a = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const mix = (f, b) => [0, 1, 2].map((k) => f[k] * f[3] + b[k] * (1 - f[3]));
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; } let base = [255, 255, 255]; for (let i = layers.length - 1; i >= 0; i--) base = mix(layers[i], base); return base; };
  // ניגודיות הטקסט הגלוי הראשון בכל אלמנט עם טקסט ישיר; מחזיר את הגרועים
  window.__low = () => { const bad = []; const w = document.createTreeWalker(document.getElementById('main'), NodeFilter.SHOW_TEXT); let n; const seen = new Set();
    while ((n = w.nextNode())) { if (!n.nodeValue.trim()) continue; const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el); const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; if (el.closest('[disabled],[aria-disabled=true]') || el.closest('input,textarea,select,option')) continue;
      const f = P(cs.color), b = bgOf(el); const fg = mix(f, b); const l1 = L(fg), l2 = L(b); const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); if (cr < 4.5) bad.push([el.tagName + '.' + String(el.className).slice(0, 20), n.nodeValue.trim().slice(0, 18), +cr.toFixed(2)]); }
    return bad.slice(0, 6); };
  window.__hs = () => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bw: document.body.scrollWidth });
})()`;
(async () => {
  const [www, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { page } = await H.newPage(browser, www, cfg, [], 'm');
  const cons = []; page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource|net::/.test(m.text())) cons.push(m.text().slice(0, 200)); });
  await page.setViewportSize({ width: 390, height: 844 });
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 400);
  await page.evaluate(BR);
  // נתוני דוגמה למסכי הניהול (רק לצילום ולבדיקה; לא נשמרים)
  await page.evaluate(() => { try { SY.biz = Object.assign({}, SY.biz, { dataRoot: 'b' }); ADM.sa = true; ADM.L = [{ id: 'bakery1', name: 'מאפיית השחר', dataRoot: 'new', features: { scan: true, shelf: true, tasks: true } }, { id: 'cafe2', name: 'בית קפה הגפן', dataRoot: 'legacy', features: {}, suspended: true }]; ADM.staff = [{ uid: 'u1', name: 'דנה כהן', email: 'dana@x.co', role: 'staff', active: true }, { uid: 'u2', name: 'יוסי לוי', email: 'yossi@x.co', role: 'staff', active: false }]; } catch (e) { /* */ } });
  const res = {};
  for (const t of ['a', 'b', 'c']) {
    await page.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'לארג׳ פעמי', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); try { ADM.sa = true; } catch (e) { /* */ } }, t);
    for (const [v, code] of VIEWS) {
      const e0 = page.__errors.length, c0 = cons.length;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate((c) => { NAV = [{ v: 'home' }]; try { (0, eval)(c); } catch (e) { window.__openErr = String(e); } }, code); await H.settle(page, 150);
      const r = await page.evaluate(() => ({ ds: document.documentElement.dataset.ds, oe: window.__openErr || '', len: document.getElementById('main').innerText.length, emo: [...document.getElementById('main').innerText.matchAll(/./gu)].length ? document.getElementById('main').innerHTML : '', low: __low() }));
      r.emo = (r.emo.match(/[\u{1F000}-\u{1FAFF}\u2600-\u2712\u2715-\u27BF⬀-⯿❓❗️]/gu) || []).join('');
      await page.evaluate(() => { window.__openErr = ''; });
      r.hs = {}; for (const w of [360]) { await page.setViewportSize({ width: w, height: 740 }); await H.settle(page, 50); r.hs[w] = await page.evaluate(() => __hs()); }
      r.err = page.__errors.slice(e0).concat(cons.slice(c0));
      res[t + ':' + v] = r;
      if (shots && ((t === 'a') || SHOT.has(v))) { await page.setViewportSize({ width: 390, height: 844 }); await H.settle(page, 50); await page.screenshot({ path: path.join(shots, `${v}-${t}-390.png`), fullPage: true }); }
    }
  }
  const R = (f) => Object.entries(res).filter(([k, r]) => !f(r)).map(([k, r]) => [k, r.err && r.err[0] || r.oe || r.emo || r.low && r.low.slice(0, 2) || r.hs]);
  check('1 כל מסך נפתח בלי שגיאת JS/קונסול (26 מסכים × 3 ערכות)', R((r) => !r.err.length && !r.oe && r.len > 0).length === 0, R((r) => !r.err.length && !r.oe && r.len > 0).slice(0, 8));
  check('2 data-ds נכון בכל ערכה', Object.entries(res).every(([k, r]) => r.ds === k[0]));
  check('3 בלי גלילה אופקית ב-360', R((r) => r.hs[360].sw <= r.hs[360].iw && r.hs[360].bw <= r.hs[360].iw).length === 0, R((r) => r.hs[360].sw <= r.hs[360].iw && r.hs[360].bw <= r.hs[360].iw).slice(0, 8));
  check('4 ניגודיות טקסט ≥4.5', R((r) => !r.low.length).length === 0, R((r) => !r.low.length).slice(0, 8));
  check('5 בלי אימוג׳י כאייקון', R((r) => !r.emo).length === 0, R((r) => !r.emo).slice(0, 12));
  // מתג ניגודיות גבוהה
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { localStorage.removeItem('lp-hc'); document.documentElement.classList.remove('hc'); NAV = [{ v: 'home' }]; go('settings'); }); await H.settle(page, 200);
  const sw = await page.evaluate(() => { const b = document.querySelector('[data-a=hc]'); return b ? { on: b.getAttribute('aria-checked'), t: b.textContent.trim().slice(0, 20) } : null; });
  check('6 בהגדרות יש מתג "ניגודיות גבוהה" ואין בורר ערכה ישן', !!sw && await page.evaluate(() => !document.querySelector('[data-a=theme]')), sw);
  await page.click('[data-a=hc]'); await H.settle(page, 150);
  const on1 = await page.evaluate(() => ({ cls: document.documentElement.classList.contains('hc'), ls: localStorage.getItem('lp-hc'), pr: document.querySelector('[data-a=hc]').getAttribute('aria-checked') }));
  await page.reload(); await H.settle(page, 2500);
  const on2 = await page.evaluate(() => document.documentElement.classList.contains('hc'));
  check('7 מתג → html.hc קיים → רענון → עדיין קיים', on1.cls && on1.pr === 'true' && on2, { on1, on2 });
  const lowHc = await page.evaluate(() => { NAV = [{ v: 'home' }]; go('settings'); return null; }); await H.settle(page, 200);
  if (shots) await page.screenshot({ path: path.join(shots, 'settings-hc-390.png'), fullPage: true });
  await page.evaluate(() => { try { localStorage.removeItem('lp-hc'); } catch (e) { /* */ } document.documentElement.classList.remove('hc'); });
  await page.reload(); await H.settle(page, 2000);
  check('8 ביטול המתג מסיר html.hc גם אחרי רענון', await page.evaluate(() => !document.documentElement.classList.contains('hc')));
  check('9 בלי שגיאות JS כלליות', page.__errors.length === 0, page.__errors.slice(0, 3));
  await browser.close();
  if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 1));
  console.log(fail ? 'נכשלו: ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
