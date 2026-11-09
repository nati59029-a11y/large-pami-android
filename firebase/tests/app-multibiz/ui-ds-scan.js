'use strict';
// עיצוב מחדש D3: הכנסת חשבונית – אריח ראשי גדול + אריחים קטנים (הכנסת מסמכים, חשבונית ספק, צילום ברצף, מסך העובד, סריקת חשבוניות, הוצאות מעובדים).
// רשת מדומה (לא צריך אמולטור). שימוש: node ui-ds-scan.js <www-dir> [out.json] [shots-dir]
// MUTATE=hero – באג מכוון: האריח הראשי מתכווץ לגובה קטן → בדיקה 2 (יחס ≥2) מכשילה.
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const PG = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../../../app-source/www/icon-192.png')).toString('base64');
const BR = `(() => {
  const P = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return [0, 0, 0, 0]; const a = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; } let acc = [255, 255, 255]; const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg'); document.body.appendChild(d); const bg = P(getComputedStyle(d).color); d.remove(); if (!layers.length || layers[layers.length - 1][3] < 1) acc = bg.slice(0, 3); for (let i = layers.length - 1; i >= 0; i--) { const c = layers[i]; acc = [0, 1, 2].map((k) => c[k] * c[3] + acc[k] * (1 - c[3])); } return acc; };
  window.__cr = (sel) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return null; const f = P(getComputedStyle(el).color), b = bgOf(el); const fg = [0, 1, 2].map((k) => f[k] * f[3] + b[k] * (1 - f[3])); const x = L(fg), y = L(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
  window.__small = (root) => [...document.querySelectorAll(root + ' button, ' + root + ' label, ' + root + ' a, ' + root + ' input:not([type=file])')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && !e.closest('[hidden]') && !(e.tagName === 'LABEL' && e.classList.contains('f') ) && !(e.tagName === 'LABEL' && e.classList.contains('cb')); }).map((e) => (e.id || e.dataset.a || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  window.__hs = () => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bw: document.body.scrollWidth });
  window.__hero = (root) => { const h = document.querySelector(root + ' .scanhero'), t = [...document.querySelectorAll(root + ' .scant')].map((e) => e.getBoundingClientRect().height); return { h: h ? Math.round(h.getBoundingClientRect().height) : 0, t: t.map(Math.round), vh: innerHeight, cap: h ? [...h.querySelectorAll('input[type=file]')].map((i) => i.getAttribute('capture') + '|' + i.dataset.c + '|' + i.accept) : [] }; };
})()`;

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let src = www;
  if (process.env.MUTATE === 'hero') {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dsc-')); fs.cpSync(www, tmp, { recursive: true });
    const f = path.join(tmp, 'index.html'); const s = fs.readFileSync(f, 'utf8'); const t = s.replace('min-height:clamp(190px,38vh,360px)', 'min-height:60px');
    if (s === t) throw new Error('mutation target not found'); fs.writeFileSync(f, t); src = tmp;
  }
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const cfgM = Object.assign({}, cfg, { ctx: { hasTouch: true, isMobile: true } }); // טלפון: (pointer:fine) כבוי, כך ש-capture נשאר
  const { page } = await H.newPage(browser, src, cfgM, [], 'm');
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 400); await page.evaluate(BR);
  const shot = async (name, pg) => { if (shots) await (pg || page).screenshot({ path: path.join(shots, name + '.png') }); };
  const setDs = (t) => page.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'לארג׳ פעמי', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); }, t);
  const all3 = async (fn) => { const r = {}; for (const t of ['a', 'b', 'c']) { await setDs(t); r[t] = await fn(t); } return r; };
  const ok3 = (r, f) => ['a', 'b', 'c'].every((t) => f(r[t]));
  const widths = async (r) => { for (const w of [320, 360, 412]) { await page.setViewportSize({ width: w, height: 700 }); await H.settle(page, 80); r['hs' + w] = await page.evaluate(() => __hs()); } await page.setViewportSize({ width: 390, height: 844 }); };
  const mn = (a) => Math.min(...a.filter((x) => x != null));
  const noHs = (r) => [320, 360, 412].every((w) => r['hs' + w].sw <= r['hs' + w].iw && r['hs' + w].bw <= r['hs' + w].iw);
  await page.setViewportSize({ width: 390, height: 844 });

  // ===== 1. הכנסת מסמכים (usStart) =====
  const us = await all3(async (t) => {
    await page.evaluate(() => { usReset && usReset(); usOpen(); }); await H.settle(page, 250);
    const r = await page.evaluate(() => ({ ...__hero('#sheet'), inputs: document.querySelectorAll('#sheet input[type=file]').length, pdf: !!document.querySelector('#sheet input[accept="application/pdf"]'), man: !!document.querySelector('#sheet [data-a=usManual]'), batch: !!document.querySelector('#sheet [data-a=usBatch]'), small: __small('#sheet .bd'), cr: [__cr('#sheet .scanhero b'), __cr('#sheet .scanhero small'), __cr('#sheet .scant span'), __cr('#sheet .note')], emoji: /[\u{1F300}-\u{1FAFF}]/u.test(document.getElementById('sheet').innerText), title: document.querySelector('#sheet .scanhero b').textContent }));
    await shot(`הכנסת-חשבונית-${t}-390`); await widths(r); return r;
  });
  check('1 הכנסת מסמכים: אותם input (3 קבצים: מצלמה עם capture=environment ו-data-c=uspick, גלריה, PDF), usManual, usBatch', ok3(us, (r) => r.inputs === 3 && r.pdf && r.man && r.batch && r.cap.length === 1 && r.cap[0] === 'environment|uspick|image/*'), Object.fromEntries(Object.entries(us).map(([k, v]) => [k, [v.inputs, v.cap, v.man, v.batch]])));
  check('2 האריח הראשי גדול לפחות פי 2 מכל אריח קטן ובערך 40% מגובה המסך', ok3(us, (r) => r.t.length === 3 && r.h >= 2 * Math.max(...r.t) && r.h >= 0.28 * r.vh), Object.fromEntries(Object.entries(us).map(([k, v]) => [k, [v.h, v.t, v.vh]])));
  check('3 מגע ≥44px, ניגודיות ≥4.5, בלי אימוג׳י', ok3(us, (r) => r.small.length === 0 && mn(r.cr) >= 4.5 && !r.emoji), Object.fromEntries(Object.entries(us).map(([k, v]) => [k, [v.small, mn(v.cr), v.emoji]])));
  check('4 בלי גלילה אופקית ב-320/360/390/412 (3 ערכות)', ok3(us, noHs), Object.fromEntries(Object.entries(us).map(([k, v]) => [k, v.hs320])));
  await setDs('a'); await page.setViewportSize({ width: 320, height: 640 }); await page.evaluate(() => { usReset && usReset(); usOpen(); }); await H.settle(page, 250); await shot('הכנסת-חשבונית-a-320'); await page.setViewportSize({ width: 390, height: 844 });

  // ===== 2. חשבונית ספק (A.step=scan), ריק ועם 2 עמודים בתור =====
  const sc = await all3(async (t) => {
    const r = {};
    await page.evaluate(() => { sheetClose && sheetClose(); const c = S.cats.find((x) => x.beh === 'sup' && !x.hid && !x.off); openAdd({ type: 'exp', cat: c.id, pre: false }); ACT.pick({ dataset: { k: 'cat', v: c.id } }); }); await H.settle(page, 250);
    r.empty = await page.evaluate(() => ({ step: A.step, ...__hero('#sheet'), small: __small('#sheet .bd'), title: document.querySelector('#sheet .scanhero b').textContent, ids: ['[data-c=scanpick]', '[data-c=scanmulti]', '[data-a=scanManual]'].map((q) => !!document.querySelector('#sheet ' + q)), cr: [__cr('#sheet .scanhero b'), __cr('#sheet .scant span')] }));
    await shot(`חשבונית-ספק-${t}-390`);
    await page.evaluate((u) => { A.pg = [u, u]; sheetDraw(); }, PG); await H.settle(page, 250);
    r.two = await page.evaluate(() => ({ ...__hero('#sheet'), thumbs: document.querySelectorAll('#sheet .scimg').length, acts: ['scanGo', 'scanQ'].map((a) => !!document.querySelector('#sheet [data-a=' + a + ']')), small: __small('#sheet .bd'), title: document.querySelector('#sheet .scanhero b').textContent, cr: [__cr('#sheet .scanhero b'), __cr('#sheet .scant span'), __cr('#sheet [data-a=scanGo]')] }));
    await shot(`חשבונית-ספק-2-עמודים-${t}-390`); await widths(r); await page.evaluate(() => { A.pg = []; sheetClose(); });
    return r;
  });
  check('5 חשבונית ספק: "צלם חשבונית", אותם input (capture=environment, scanpick, scanmulti), המשך ידני', ok3(sc, (r) => r.empty.step === 'scan' && r.empty.title === 'צלם חשבונית' && r.empty.cap.join() === 'environment|scanpick|image/*' && r.empty.ids.every(Boolean)), Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, [v.empty.step, v.empty.title, v.empty.cap, v.empty.ids]])));
  check('5א חשבונית ספק עם 2 עמודים בתור: תמונות ממוזערות, זהה/הוסף לתור, האריח הראשי "צלם עמוד נוסף", מגע ≥44, ניגודיות, בלי גלילה', ok3(sc, (r) => r.two.thumbs === 2 && r.two.acts.every(Boolean) && r.two.title === 'צלם עמוד נוסף' && r.two.small.length === 0 && mn(r.two.cr) >= 4.5 && r.empty.small.length === 0 && mn(r.empty.cr) >= 4.5 && noHs(r)), Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, [v.two.thumbs, v.two.title, v.two.small, v.empty.small, mn(v.two.cr)]])));
  check('5ב חשבונית ספק ריקה: האריח הראשי ≥ פי 2 מהקטנים', ok3(sc, (r) => r.empty.h >= 2 * Math.max(...r.empty.t)), Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, [v.empty.h, v.empty.t]])));

  // ===== 3. צילום ברצף =====
  const bt = await all3(async (t) => { await page.evaluate(() => { usReset && usReset(); usOpen(); ACT.usBatch(); }); await H.settle(page, 250);
    const r = await page.evaluate(() => ({ ...__hero('#sheet'), go: !!document.querySelector('#sheet [data-a=usBatchGo]'), small: __small('#sheet .bd'), cr: [__cr('#sheet .scanhero b'), __cr('#sheet .scant span')] })); if (t === 'a') await shot('צילום-ברצף-a-390'); await page.evaluate(() => usReset()); return r; });
  check('6 צילום ברצף: אותו input (capture, uspick), usBatchGo, מגע וניגודיות', ok3(bt, (r) => r.cap.includes('environment|uspick|image/*') && r.go && r.small.length === 0 && mn(r.cr) >= 4.5), Object.fromEntries(Object.entries(bt).map(([k, v]) => [k, [v.cap, v.go, v.small]])));

  // ===== 4. סריקת חשבוניות (V.scan) והוצאות מעובדים (V.inbox) =====
  const sq = await all3(async (t) => { const r = {};
    await page.evaluate(() => { NAV = [{ v: 'scan' }]; render(0); }); await H.settle(page, 200);
    r.scan = await page.evaluate(() => ({ cap: [...document.querySelectorAll('#main .scanhero input')].map((i) => i.dataset.c + '|' + i.multiple), small: __small('#main'), cr: [__cr('#main .scanhero b'), __cr('#main .note')] })); if (t === 'a') await shot('סריקת-חשבוניות-a-390');
    await page.evaluate(() => { S.inbox = [{ id: 'i1', by: 'דני', at: '2026-11-03T08:00:00Z', d: { amt: '120', date: '2026-11-03', desc: 'ירקות', plan: '2026-12' }, rq: { n: 'חסרה חותמת' }, rph: 1 }, { id: 'i2', by: 'רונית', at: '2026-11-02T08:00:00Z', d: { amt: '75', date: '2026-11-02', desc: 'חלב' } }]; NAV = [{ v: 'inbox' }]; render(0); }); await H.settle(page, 200);
    r.inbox = await page.evaluate(() => ({ emoji: /[\u{1F300}-\u{1FAFF}⚠✓]/u.test(document.getElementById('main').innerText), icons: document.querySelectorAll('#main .scnote .sci').length, small: __small('#main'), cr: [__cr('#main .scnote.acc'), __cr('#main .scnote.ok'), __cr('#main .card b')].filter((x) => x), txt: /ביקשת צילום חדש/.test(document.getElementById('main').innerText) && /התקבל צילום חדש/.test(document.getElementById('main').innerText) })); if (t === 'a') await shot('הוצאות-מעובדים-a-390');
    await page.evaluate(() => { S.inbox = []; NAV = [{ v: 'home' }]; render(0); }); await widths(r); return r; });
  check('7 סריקת חשבוניות: האריח הראשי עם scanFiles (multiple), מגע וניגודיות', ok3(sq, (r) => r.scan.cap.join() === 'scanFiles|true' && r.scan.small.length === 0 && mn(r.scan.cr) >= 4.5), Object.fromEntries(Object.entries(sq).map(([k, v]) => [k, [v.scan.cap, v.scan.small]])));
  check('8 הוצאות מעובדים: בלי אימוג׳י (⚠ 📷 ✓ הוחלפו ב-SVG), הטקסטים נשמרו, ניגודיות ≥4.5, בלי גלילה אופקית', ok3(sq, (r) => !r.inbox.emoji && r.inbox.icons >= 2 && r.inbox.txt && mn(r.inbox.cr) >= 4.5 && noHs(r)), Object.fromEntries(Object.entries(sq).map(([k, v]) => [k, [v.inbox.emoji, v.inbox.icons, v.inbox.txt, v.inbox.cr]])));

  // ===== 5. מחשב: "העלה" במקום "צלם", בלי capture (דפדפן שולחני, עכבר) =====
  const { page: pd } = await H.newPage(browser, src, cfg, [], 'm'); await pd.setViewportSize({ width: 1366, height: 768 }); await H.login(pd, 'm@x.co');
  await pd.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(pd, 400);
  const dk = await pd.evaluate(async () => { usReset && usReset(); usOpen(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const sh = document.getElementById('sheet'); const c1 = { bzd: document.documentElement.classList.contains('bzd'), cap: sh.querySelectorAll('input[capture]').length, ttl: sh.querySelector('.scanhero b').textContent };
    document.body.insertAdjacentHTML('beforeend', '<label id="tcam">📷 צלם חשבונית<input type="file" capture="environment" hidden></label><label id="tcam2"><b>צילום חשבונית</b><input type="file" capture="environment" hidden></label>'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c2 = { a: document.getElementById('tcam').innerText.trim(), b: document.getElementById('tcam2').innerText.trim(), cap: document.querySelectorAll('#tcam input[capture],#tcam2 input[capture]').length }; document.getElementById('tcam').remove(); document.getElementById('tcam2').remove(); usReset(); return { c1, c2 }; });
  check('9 במחשב: האריח הראשי "העלאת חשבונית" בלי capture; תוכן שנוצר אחר כך מומר (כולל בלי אימוג׳י ובתוך <b>)', dk.c1.bzd && dk.c1.cap === 0 && /העלאת חשבונית/.test(dk.c1.ttl) && dk.c2.a === '📁 העלה חשבונית' && dk.c2.b === 'העלאת חשבונית' && dk.c2.cap === 0, dk);
  check('10 אין שגיאות JS (מנהל, מחשב)', page.__errors.length === 0 && pd.__errors.length === 0, page.__errors.concat(pd.__errors));

  // ===== 6. עובד: הוצאה (WS=exp) וטופס ידני =====
  const { page: pw } = await H.newPage(browser, src, cfgM, [], 'w'); await pw.setViewportSize({ width: 390, height: 844 }); await H.login(pw, 'w@x.co'); await pw.evaluate(BR);
  const wkR = {};
  for (const t of ['a', 'b', 'c']) {
    await pw.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'x', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); WK.pages = []; WS = 'exp'; render(0); }, t); await H.settle(pw, 250);
    const r = {}; r.exp = await pw.evaluate(() => ({ ...__hero('#main'), small: __small('#main'), cr: [__cr('#main .scanhero b'), __cr('#main .scant span')], man: !!document.querySelector('#main [data-a=wkManual]') })); if (t === 'a') await shot('עובד-הוצאה-a-390', pw);
    await pw.evaluate(() => { WK.pages = []; WS = 'manual'; WK.reg = false; render(0); }); await H.settle(pw, 200);
    r.form = await pw.evaluate(() => ({ title: (document.querySelector('#main .scanhero b') || {}).textContent, cap: [...document.querySelectorAll('#main .scanhero input')].map((i) => i.dataset.c + '|' + i.getAttribute('capture')), small: __small('#main form'), h: Math.round(document.querySelector('#main .scanhero').getBoundingClientRect().height) }));
    for (const w of [320, 412]) { await pw.setViewportSize({ width: w, height: 700 }); await H.settle(pw, 80); r['hs' + w] = await pw.evaluate(() => __hs()); } await pw.setViewportSize({ width: 390, height: 844 }); wkR[t] = r;
  }
  check('11 עובד, מסך "הוצאה": אריח ראשי (capture, wkpick) ≥ פי 2, הכנסה ידנית, מגע וניגודיות', ok3(wkR, (r) => r.exp.cap.join() === 'environment|wkpick|image/*' && r.exp.h >= 2 * Math.max(...r.exp.t) && r.exp.small.length === 0 && mn(r.exp.cr) >= 4.5 && r.exp.man), Object.fromEntries(Object.entries(wkR).map(([k, v]) => [k, [v.exp.cap, v.exp.h, v.exp.t, v.exp.small]])));
  check('12 עובד, טופס ידני: "חובה: צלם חשבונית / דף הוצאה" נשמר, קומפקטי, אותו input, בלי גלילה אופקית', ok3(wkR, (r) => r.form.title === 'חובה: צלם חשבונית / דף הוצאה' && r.form.cap.join() === 'wkpick|environment' && r.form.h < 140 && noHs({ hs320: r.hs320, hs360: r.hs320, hs412: r.hs412 })), Object.fromEntries(Object.entries(wkR).map(([k, v]) => [k, [v.form.title, v.form.cap, v.form.h]])));
  check('13 אין שגיאות JS (עובד)', pw.__errors.length === 0, pw.__errors);
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? 'תוצאה: ' + fail + ' נכשלו' : 'תוצאה: הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
