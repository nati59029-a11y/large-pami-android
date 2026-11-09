'use strict';
// עיצוב מחדש D2: כניסה (#gate), נעילה ביומטרית (#bzlk), השהיה (#susp), בית, כותרת, ניווט תחתון, "עוד" – בשלוש הערכות.
// רשת מדומה (לא צריך אמולטור). שימוש: node ui-ds-shell.js <www-dir> [out.json] [shots-dir]
// MUTATE=accent – באג מכוון: כתום ערכה ב חוזר ל-#c2441d (ניגודיות 4.50 בלי מרווח) → בדיקה 9 מכשילה.
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const PNG = fs.readFileSync(path.join(__dirname, '../../../app-source/www/icon-192.png')).toString('base64'); // הלוגו האמיתי
// עזרי דפדפן: ניגודיות אפקטיבית (עם ערבוב שקיפות לאורך האבות), מידות מגע, גלילה אופקית
const BR = `(() => {
  const P = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return [0, 0, 0, 0]; const a = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const bgOf = (el) => { let layers = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; } let base = [255, 255, 255]; if (!layers.length || layers[layers.length - 1][3] < 1) base = P(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() ? (() => { const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg'); document.body.appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r; })() : 'rgb(255,255,255)'); let acc = base.slice(0, 3); for (let i = layers.length - 1; i >= 0; i--) { const c = layers[i]; acc = [0, 1, 2].map((k) => c[k] * c[3] + acc[k] * (1 - c[3])); } return acc; };
  window.__cr = (sel) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return null; const f = P(getComputedStyle(el).color), b = bgOf(el); const fa = f[3]; const fg = [0, 1, 2].map((k) => f[k] * fa + b[k] * (1 - fa)); const x = L(fg), y = L(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
  window.__small = (root) => [...document.querySelectorAll(root + ' button, ' + root + ' a, ' + root + ' input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && !e.closest('[hidden]'); }).map((e) => (e.id || e.dataset.a || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  window.__hs = () => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bw: document.body.scrollWidth });
})()`;
const LOGO_THEMES = { a: 'כהה', b: 'בהיר', c: 'בהיר-פלדה' };

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let src = www;
  if (process.env.MUTATE === 'accent') {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dsh-')); fs.cpSync(www, tmp, { recursive: true });
    const f = path.join(tmp, 'index.html'); const s = fs.readFileSync(f, 'utf8'); const t = s.replace('--acc:#b23c17;', '--acc:#c2441d;');
    if (s === t) throw new Error('mutation target not found'); fs.writeFileSync(f, t); src = tmp;
  }
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { page } = await H.newPage(browser, src, cfg, [], 'm');
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }); };

  // ===== 1. מסך כניסה בכל ערכה =====
  const gateRes = {};
  for (const t of ['a', 'b', 'c']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(H.ORIGIN + '/?emu=1'); await page.evaluate(([u, t]) => localStorage.setItem('lp-lastlogo', JSON.stringify({ u: 'data:image/png;base64,' + u, n: 'לארג׳ פעמי', t })), [PNG, t]);
    await page.reload(); await page.waitForSelector('#gform'); await page.evaluate(BR); await H.settle(page, 300);
    const r = await page.evaluate(() => ({
      ds: document.documentElement.dataset.ds, ids: ['gform', 'gerr', 'gbtn', 'geye', 'gfgt'].every((i) => document.getElementById(i)) && !!document.querySelector('#gform input[name=email]') && !!document.querySelector('#gform input[name=pw]'),
      cr: { label: __cr('#gate .gf span'), kicker: __cr('#gate .gk'), head: __cr('#gate .gh'), foot: __cr('#gate .gfoot'), btn: __cr('#gbtn'), input: __cr('#gform input[name=email]'), link: __cr('#gfgt') },
      small: __small('#gate'), bg: getComputedStyle(document.getElementById('gate')).backgroundColor, card: getComputedStyle(document.querySelector('#gate .gcard')).backgroundColor }));
    await page.fill('#gform input[name=email]', 'x'); await page.click('#gbtn'); await H.settle(page, 200);
    r.err = await page.evaluate(() => ({ t: document.getElementById('gerr').textContent, c: __cr('#gerr') }));
    await page.evaluate(() => { document.getElementById('gerr').textContent = ''; });
    await shot(`כניסה-${t}-390`); gateRes[t] = r;
    for (const w of [320, 360, 412]) { await page.setViewportSize({ width: w, height: 640 }); await H.settle(page, 100); r['hs' + w] = await page.evaluate(() => __hs()); if (t === 'a' && w === 320) await shot('כניסה-a-320'); }
  }
  const mn = (o) => Math.min(...Object.values(o).filter((x) => x != null));
  check('1 כניסה: data-ds נכון, כל ה-id והשדות נשמרו', ['a', 'b', 'c'].every((t) => gateRes[t].ds === t && gateRes[t].ids), Object.fromEntries(Object.entries(gateRes).map(([k, v]) => [k, [v.ds, v.ids]])));
  check('2 כניסה: ניגודיות כל הטקסטים ≥4.5 בשלוש הערכות (חישוב אפקטיבי)', ['a', 'b', 'c'].every((t) => mn(gateRes[t].cr) >= 4.5 && gateRes[t].err.c >= 4.5 && gateRes[t].err.t), Object.fromEntries(Object.entries(gateRes).map(([k, v]) => [k, [mn(v.cr), v.err.c]])));
  check('3 כניסה: מגע ≥44px בכל כפתור/שדה', ['a', 'b', 'c'].every((t) => gateRes[t].small.length === 0), Object.fromEntries(Object.entries(gateRes).map(([k, v]) => [k, v.small])));
  check('4 כניסה: בלי גלילה אופקית ב-320/360/390/412', ['a', 'b', 'c'].every((t) => [320, 360, 412].every((w) => gateRes[t]['hs' + w].sw <= gateRes[t]['hs' + w].iw && gateRes[t]['hs' + w].bw <= gateRes[t]['hs' + w].iw)), Object.fromEntries(Object.entries(gateRes).map(([k, v]) => [k, [v.hs320, v.hs412]])));
  check('4א כניסה: כהה ב-a, בהירה ב-b וב-c (רקע המשטח לא קבוע)', (() => { const lum = (s) => { const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(s); return (+m[1] + +m[2] + +m[3]) / 3; }; return lum(gateRes.a.card) < 90 && lum(gateRes.b.card) > 200 && lum(gateRes.c.card) > 200; })(), Object.fromEntries(Object.entries(gateRes).map(([k, v]) => [k, v.card])));
  // reduced motion
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const rm = await page.evaluate(() => { const b = document.getElementById('gbtn'); b.classList.add('ld'); const s = getComputedStyle(b.querySelector('span'), '::after'); return { tr: parseFloat(getComputedStyle(b).transitionDuration), an: parseFloat(s.animationDuration) }; });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('5 reduced-motion: מעבר ואנימציית הטעינה כבויים', rm.tr <= 0.001 && rm.an <= 0.001, rm);

  // ===== 2. אפליקציה: בית, עוד, הגדרות =====
  await page.evaluate(() => localStorage.removeItem('lp-lastlogo'));
  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 400);
  await page.evaluate(BR);
  // נתונים: הכנסות והוצאות, חשבונית פתוחה, ובמקרה קצה סכומים גדולים
  await page.evaluate(() => { const ic = S.cats.find((c) => c.kind === 'inc'), fc = S.cats.find((c) => c.kind === 'exp' && c.beh === 'free'); S.tx.push({ id: 'in1', t: 'inc', cat: ic.id, date: '2026-11-01', amt: 1234567.5, note: '', pays: [] }); S.tx.push({ id: 'ex9', t: 'exp', cat: fc.id, date: '2026-11-02', amt: 987654.25, note: '', pays: [] }); save(); NAV = [{ v: 'home' }]; render(0); });
  const homeRes = {};
  for (const t of ['a', 'b', 'c']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'לארג׳ פעמי', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); NAV = [{ v: 'home' }]; render(0); }, t); await H.settle(page, 250);
    const r = await page.evaluate(() => ({ ds: document.documentElement.dataset.ds, ids: !!document.querySelector('#hmain') && !!document.querySelector('#profit') && !!document.querySelector('#hmain [data-a=tab][data-v=inc]') && !!document.querySelector('#hmain [data-a=tab][data-v=exp]') && document.querySelectorAll('#hcards > button').length === 3 && ['hm', 'repAll', 'go'].every((a) => document.querySelector('[data-a=' + a + ']')) && document.querySelectorAll('.hacts [data-a]').length === 4 && document.querySelectorAll('.bar [data-a]').length === 5,
      cr: { big: __cr('#hmain .big'), small: __cr('#hmain small'), inc: __cr('#hmain .two [data-v=inc] b'), exp: __cr('#hmain .two [data-v=exp] b'), pill: __cr('#hmain .pill'), k: __cr('#hcards .k b'), ks: __cr('#hcards .k small'), act: __cr('.hacts .chip'), nav: __cr('.bar button:not(.on)'), navOn: __cr('.bar button.on'), ttl: __cr('#ttl'), sec: __cr('#main .sec h3') },
      small: __small('#main').concat(__small('.bar'), __small('.top')), bigPx: parseFloat(getComputedStyle(document.querySelector('#hmain .big')).fontSize) }));
    await shot(`בית-${t}-390`);
    for (const w of [320, 360, 412]) { await page.setViewportSize({ width: w, height: 700 }); await H.settle(page, 80); r['hs' + w] = await page.evaluate(() => __hs()); if (w === 320) r.kov = await page.evaluate(() => [...document.querySelectorAll('#hcards .k')].filter((k) => k.scrollWidth > k.clientWidth + 1).length); }
    homeRes[t] = r;
  }
  const all3 = (f) => ['a', 'b', 'c'].every((t) => f(homeRes[t]));
  check('6 בית: data-ds, ה-id/data-a נשמרו (hmain, profit, tab inc/exp, 3 כרטיסים, 4 פעולות, 5 כפתורי ניווט)', all3((r) => r.ids) && ['a', 'b', 'c'].every((t) => homeRes[t].ds === t), Object.fromEntries(Object.entries(homeRes).map(([k, v]) => [k, [v.ds, v.ids]])));
  check('7 בית: ניגודיות ≥4.5 לכל הטקסטים (כרטיס רווח, KPI, פעולות, ניווט, כותרת) בשלוש הערכות', all3((r) => mn(r.cr) >= 4.5), Object.fromEntries(Object.entries(homeRes).map(([k, v]) => [k, [mn(v.cr), Object.entries(v.cr).filter(([, x]) => x < 4.5)]])));
  check('7א בית: מגע ≥44px (ראש, תוכן, ניווט)', all3((r) => r.small.length === 0), Object.fromEntries(Object.entries(homeRes).map(([k, v]) => [k, v.small])));
  check('7ב בית: בלי גלילה אופקית ב-320/360/390/412 גם עם סכומים של מיליון, וכרטיסי ה-KPI לא גולשים', all3((r) => [320, 360, 412].every((w) => r['hs' + w].sw <= r['hs' + w].iw && r['hs' + w].bw <= r['hs' + w].iw) && r.kov === 0), Object.fromEntries(Object.entries(homeRes).map(([k, v]) => [k, [v.hs320, v.kov]])));
  check('7ג בית: ספרת הרווח גדולה (≥2.4rem)', all3((r) => r.bigPx >= 2.4 * parseFloat(16)), Object.fromEntries(Object.entries(homeRes).map(([k, v]) => [k, v.bigPx])));

  // ערכה ב: כתום עם מרווח
  const accB = await page.evaluate(() => { const g = (t) => { document.documentElement.dataset.ds = t; const cs = getComputedStyle(document.documentElement); return ['bg', 'card', 'acc', 'onacc'].map((k) => cs.getPropertyValue('--' + k).trim()); }; return { b: g('b'), c: g('c') }; });
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }, lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }, cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const [bb, bc, ba, bo] = accB.b; const crB = [cr(ba, bb), cr(ba, bc), cr(bo, ba)].map((x) => Math.round(x * 100) / 100);
  check('9 ערכה ב: הכתום כהה מספיק (≥4.8 על הרקע, ≥4.8 על הכרטיס, ≥4.8 לטקסט עליו)', Math.min(...crB) >= 4.8, { acc: ba, crB });

  // עוד
  await page.evaluate(() => { document.documentElement.dataset.ds = 'a'; SY.biz = Object.assign({}, SY.biz, { brand: { name: 'לארג׳ פעמי', colors: {}, theme: 'a', base: 'dark-gold' } }); bzSkin(); NAV = [{ v: 'more' }]; render(0); }); await H.settle(page, 200);
  const moreRes = {};
  for (const t of ['a', 'b', 'c']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'לארג׳ פעמי', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); NAV = [{ v: 'more' }]; render(0); }, t); await H.settle(page, 200);
    const r = await page.evaluate(() => { const emo = /[\u{1F300}-\u{1FAFF}☀-➿]/u; return { n: document.querySelectorAll('.mlist .opt').length, emoji: emo.test(document.getElementById('main').innerText), small: __small('#main'), cr: [__cr('.mlist .opt b') || __cr('.mlist .opt span'), __cr('.mlist .opt small')].filter((x) => x != null), txt: document.getElementById('main').innerText }; });
    await shot(`עוד-${t}-390`);
    r.hs = []; for (const w of [320, 412]) { await page.setViewportSize({ width: w, height: 700 }); r.hs.push(await page.evaluate(() => __hs())); }
    moreRes[t] = r;
  }
  check('10 עוד: רשימה אחת, בלי אימוג׳י כאייקון, כל הפריטים והטקסטים, מגע ≥44, ניגודיות, בלי גלילה אופקית', ['a', 'b', 'c'].every((t) => { const r = moreRes[t]; return r.n >= 8 && !r.emoji && r.small.length === 0 && Math.min(...r.cr) >= 4.5 && r.hs.every((h) => h.sw <= h.iw) && /סגירת קופה/.test(r.txt) && /בקשות לעדכון האפליקציה/.test(r.txt) && /צילום העברה|חשבוניות לתשלום/.test(r.txt); }), Object.fromEntries(Object.entries(moreRes).map(([k, v]) => [k, [v.n, v.emoji, v.small, v.cr]])));

  // הגדרות: אין בורר ערכות ישן; נשארים בורר העיצוב האישי וגודל הכתב
  await page.setViewportSize({ width: 390, height: 844 });
  const st = await page.evaluate(() => { NAV = [{ v: 'settings' }]; render(0); const m = document.getElementById('main'); const th = S.theme; return { old: m.querySelectorAll('[data-a=theme]').length, th: S.theme, ds: !!m.querySelector('.dsp'), fs: m.querySelectorAll('[data-a=fs]').length, txt: /ערכות קלאסיות|ערכות העסק/.test(m.innerText) }; });
  check('11 הגדרות: בורר הערכות הישן הוסר (בלי data-a=theme), נשארו בורר העיצוב וגודל הכתב, S.theme לא נמחק', st.old === 0 && !st.txt && st.ds && st.fs === 3, st);
  // נעילה ביומטרית והשהיה
  const lk = {};
  for (const t of ['a', 'b']) {
    await page.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'לארג׳ פעמי', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); bioCover(1); }, t); await H.settle(page, 150);
    lk[t] = await page.evaluate(() => ({ ids: !!document.querySelector('#bzlk [data-a=bioTry]') && !!document.querySelector('#bzlk [data-a=bioLkOut]') && !!document.getElementById('bzlkM'), cr: [__cr('#bzlk h2'), __cr('#bzlk .note'), __cr('#bzlk [data-a=bioTry]'), __cr('#bzlk [data-a=bioLkOut]')], small: __small('#bzlk'), hs: __hs() }));
    if (t === 'a') await shot('נעילה-a-390'); await page.evaluate(() => bioCover(0));
  }
  check('12 נעילה ביומטרית: אותם כפתורים/id, ניגודיות ≥4.5, מגע ≥44, בלי גלילה', ['a', 'b'].every((t) => lk[t].ids && Math.min(...lk[t].cr) >= 4.5 && lk[t].small.length === 0 && lk[t].hs.sw <= lk[t].hs.iw), lk);
  const sp = {};
  for (const t of ['a', 'b']) {
    await page.evaluate((t) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'לארג׳ פעמי', colors: {}, theme: t, base: 'dark-gold' } }); BZK = '~'; bzSkin(); showSusp(); }, t); await H.settle(page, 150);
    sp[t] = await page.evaluate(() => ({ ids: !!document.querySelector('#susp [data-a=suspUpd]') && !!document.querySelector('#susp [data-a=syOut]') && !!document.getElementById('suspM'), cr: [__cr('#susp h2'), __cr('#susp .note'), __cr('#susp [data-a=suspUpd]'), __cr('#susp [data-a=syOut]')], small: __small('#susp'), hs: __hs() }));
    if (t === 'a') await shot('השהיה-a-390'); await page.evaluate(() => { const e = document.getElementById('susp'); if (e) e.remove(); document.body.classList.remove('susp'); });
  }
  check('13 מסך השהיה: אותם כפתורים/id, ניגודיות ≥4.5, מגע ≥44, בלי גלילה', ['a', 'b'].every((t) => sp[t].ids && Math.min(...sp[t].cr) >= 4.5 && sp[t].small.length === 0 && sp[t].hs.sw <= sp[t].hs.iw), sp);
  check('14 אין שגיאות JS', page.__errors.length === 0, page.__errors);
  // עובד: בית עם ערכת העסק, בלי כפילות
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? 'תוצאה: ' + fail + ' נכשלו' : 'תוצאה: הכול עבר');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
