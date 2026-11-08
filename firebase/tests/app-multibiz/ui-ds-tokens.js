'use strict';
// עיצוב מחדש D1: ערכות עיצוב (a/b/c), צבעים מהלוגו (dsDerive), מיפוי base ישן, data-ds, lp-lastlogo.t, בחירה אישית של מנהל, וצילומים.
// רשת מדומה (לא צריך אמולטור). שימוש: node ui-ds-tokens.js <www-dir> [out.json] [shots-dir]
// MUTATE=mapBase – באג מכוון (dark-gold → b) כדי לוודא שהבדיקה מכשילה.
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
// חישוב ניגודיות עצמאי (WCAG), לא מהקוד של האפליקציה
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgb2hex = (s) => { const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(s); return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join(''); };

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let src = www;
  if (process.env.MUTATE === 'mapBase') { // עותק זמני עם באג מכוון
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dsm-')); fs.cpSync(www, tmp, { recursive: true });
    const f = path.join(tmp, 'index.html'); const s = fs.readFileSync(f, 'utf8'); const t = s.replace("dsMap=b=>b==='dark-gold'?'a':'a'", "dsMap=b=>b==='dark-gold'?'b':'a'");
    if (s === t) throw new Error('mutation target not found'); fs.writeFileSync(f, t); src = tmp;
  }
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };

  // ---- מנהל ----
  const { ctx, page } = await H.newPage(browser, src, cfg, [], 'm'); await page.setViewportSize({ width: 390, height: 844 });
  // מסך כניסה לפני זיהוי עסק: ברירת מחדל a; עם lp-lastlogo.t = 'b' → b; ערך זדוני → a
  await page.goto(H.ORIGIN + '/?emu=1'); await page.waitForSelector('#gform');
  const g0 = await page.evaluate(() => document.documentElement.dataset.ds);
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAQMAAACTPww9AAAAA1BMVEX/AAAZ4gk3AAAAC0lEQVQI12NgQAcAABQAAWJcPPEAAAAASUVORK5CYII=';
  await page.evaluate((u) => localStorage.setItem('lp-lastlogo', JSON.stringify({ u: 'data:image/png;base64,' + u, n: 'אקמי', t: 'b' })), PNG);
  await page.reload(); await page.waitForSelector('#gform'); const g1 = await page.evaluate(() => document.documentElement.dataset.ds);
  await page.evaluate((u) => localStorage.setItem('lp-lastlogo', JSON.stringify({ u: 'data:image/png;base64,' + u, n: 'אקמי', t: '"><x' })), PNG);
  await page.reload(); await page.waitForSelector('#gform'); const g2 = await page.evaluate(() => document.documentElement.dataset.ds);
  check('1 מסך כניסה: בלי זיכרון → a; lp-lastlogo.t=b → b; ערך לא תקין → a', g0 === 'a' && g1 === 'b' && g2 === 'a', { g0, g1, g2 });
  await page.evaluate(() => localStorage.removeItem('lp-lastlogo'));

  await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 500);
  const sBefore = await page.evaluate(() => JSON.stringify(Object.keys(S).sort()));

  // 2. 18 שילובים: 3 ערכות × 6 לוגואים → bzOk + חישוב עצמאי
  const LOGOS = { 'כתום': '#e0623a', 'ירוק': '#2f9e44', 'כחול': '#1d4ed8', 'אדום': '#d11a2a', 'שחור-לבן': '#000000', 'צהוב בהיר': '#ffe66d' };
  const r18 = await page.evaluate((L) => { const o = []; for (const t of ['a', 'b', 'c']) for (const [n, h] of Object.entries(L)) { const c = dsDerive(t, h); o.push({ t, n, c, ok: bzOk(c), dark: bzLum(c.bg) < 0.18 }); } return o; }, LOGOS);
  const indep = (c) => { const mut = (() => { const p = [1, 3, 5].map((i) => parseInt(c.ink.slice(i, i + 2), 16)), q = [1, 3, 5].map((i) => parseInt(c.bg.slice(i, i + 2), 16)); return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * 0.25).toString(16).padStart(2, '0')).join(''); })();
    return Math.min(cr(c.ink, c.bg), cr(c.ink, c.card), cr(c.ink, c.acc2), cr(mut, c.bg), cr(mut, c.card), cr(c.acc, c.bg), cr(c.acc, c.card), cr(c.onacc, c.acc)); };
  check('2 18 שילובים (3 ערכות × 6 לוגואים): bzOk לכולם וחישוב עצמאי ≥4.5', r18.length === 18 && r18.every((x) => x.ok && indep(x.c) >= 4.5), r18.map((x) => x.t + x.n + ':' + indep(x.c).toFixed(2)));
  check('2א ערכה a כהה, b ו-c בהירות (בכל הלוגואים)', r18.every((x) => (x.t === 'a') === x.dark), r18.filter((x) => (x.t === 'a') !== x.dark).map((x) => x.t + x.n));

  // 3. מיפוי: dark-gold בלי theme → a; theme תקין גובר; theme לא תקין → לפי base; בלי brand → a
  const mp = await page.evaluate(() => ({ dg: dsOf({ base: 'dark-gold' }), other: dsOf({ base: 'x' }), b: dsOf({ base: 'dark-gold', theme: 'b' }), bad: dsOf({ base: 'dark-gold', theme: 'z' }), none: dsOf(null) }));
  check('3 מיפוי: dark-gold → a; theme=b → b; theme לא תקין → a; בלי brand → a', mp.dg === 'a' && mp.other === 'a' && mp.b === 'b' && mp.bad === 'a' && mp.none === 'a', mp);

  // 4. עסק בלי brand (לארג' פעמי) – data-ds=a וניגודיות ברירת המחדל תקינה
  const d4 = await page.evaluate(() => { NAV = [{ v: 'home' }]; render(0); const cs = getComputedStyle(document.documentElement), g = (k) => cs.getPropertyValue('--' + k).trim(); return { ds: document.documentElement.dataset.ds, c: { bg: g('bg'), card: g('card'), ink: g('ink'), acc: g('acc'), acc2: g('acc2'), onacc: g('onacc') }, ok: null }; });
  check('4 עסק בלי מיתוג: ערכה a, וכל הזוגות ≥4.5 (חישוב עצמאי)', d4.ds === 'a' && indep(d4.c) >= 4.5, d4);

  // 5. ברירות המחדל של שלוש הערכות (בלי מיתוג) – ניגודיות
  const defs = await page.evaluate(() => { const o = {}; for (const t of ['a', 'b', 'c']) { document.documentElement.dataset.ds = t; const cs = getComputedStyle(document.documentElement), g = (k) => cs.getPropertyValue('--' + k).trim(); o[t] = { bg: g('bg'), card: g('card'), ink: g('ink'), acc: g('acc'), acc2: g('acc2'), onacc: g('onacc') }; } dsApply(); return o; });
  check('5 ברירות המחדל של a/b/c עוברות 4.5:1 בכל הזוגות', Object.values(defs).every((c) => indep(c) >= 4.5), Object.fromEntries(Object.entries(defs).map(([k, c]) => [k, +indep(c).toFixed(2)])));

  // 6. עסק עם brand.theme=b וצבעים: data-ds=b; בחירה אישית של מנהל c גוברת וצבעים נגזרים מחדש; "ברירת מחדל" מחזיר b
  const d6 = await page.evaluate(() => {
    const cols = dsDerive('b', '#1d4ed8'); SY.biz = Object.assign({}, SY.biz, { brand: { name: 'בדיקה', colors: cols, theme: 'b', base: 'dark-gold' } }); BZK = '~'; NAV = [{ v: 'settings' }]; render(0);
    const r = { biz: document.documentElement.dataset.ds, row: !!document.querySelector('[data-a=dsMine]'), n: document.querySelectorAll('[data-a=dsMine]').length };
    document.querySelector('[data-a=dsMine][data-v=c]').click(); r.mine = document.documentElement.dataset.ds; r.key = Object.keys(localStorage).find((k) => /lp-ds:/.test(k)) || ''; r.bgMine = document.documentElement.style.getPropertyValue('--bg'); r.okMine = bzOk(Object.fromEntries(BZC.map((k) => [k, document.documentElement.style.getPropertyValue('--' + k)])));
    r.checked = (document.querySelector('[data-a=dsMine][aria-checked=true]') || {}).dataset; r.checked = r.checked && r.checked.v;
    document.querySelector('[data-a=dsMine][data-v=""]').click(); r.back = document.documentElement.dataset.ds; r.bgBack = document.documentElement.style.getPropertyValue('--bg'); r.colsBg = cols.bg; r.left = Object.keys(localStorage).filter((k) => /lp-ds:/.test(k)).length;
    return r;
  });
  check('6 brand.theme=b → data-ds=b; מנהל בוחר c → c (נשמר ב-lp-ds:<uid>, צבעים נגזרים ותקינים); "ברירת המחדל של העסק" → b', d6.biz === 'b' && d6.row && d6.n === 4 && d6.mine === 'c' && /lp-ds:m$/.test(d6.key) && d6.okMine && d6.bgMine !== d6.colsBg && d6.checked === 'c' && d6.back === 'b' && d6.bgBack === d6.colsBg && d6.left === 0, d6);

  // 7. מבנה S לא השתנה; אין שגיאות JS
  const sAfter = await page.evaluate(() => JSON.stringify(Object.keys(S).sort()));
  check('7 מבנה S ללא שינוי (מפתחות זהים)', sBefore === sAfter, null);

  // צילומים: בית, הוצאות, מסך מיתוג (לוגו כתום וכחול) × 3 ערכות, 390px
  if (shots) {
    for (const t of ['a', 'b', 'c']) for (const [ln, acc] of [['כתום', '#e0623a'], ['כחול', '#1d4ed8']]) {
      await page.evaluate(([t, acc]) => { SY.biz = Object.assign({}, SY.biz, { brand: { name: 'לארג׳ פעמי', colors: dsDerive(t, acc), theme: t } }); BZK = '~'; }, [t, acc]);
      for (const [n, v] of [['בית', 'home'], ['הוצאות', 'exp'], ['הגדרות', 'settings']]) {
        if (ln === 'כחול' && n !== 'בית') continue;
        await page.evaluate((v) => { NAV = [{ v }]; render(0); }, v); await H.settle(page, 400);
        await page.screenshot({ path: path.join(shots, `${t}-${n}-${ln}.png`), fullPage: n !== 'הגדרות' });
      }
    }
  }
  // מסך המיתוג (מנהל־על) × 3 ערכות × לוגו כתום/כחול: בחירת ערכה גוזרת צבעים תקינים
  const br = await page.evaluate(() => { ADM.sa = 1; ADM.L = [{ id: 'acme', name: 'מאפיית אקמי', dataRoot: 'b', brand: { name: 'מאפיית אקמי', colors: {}, base: 'dark-gold' } }]; SY.biz = Object.assign({}, SY.biz, { brand: undefined }); BZK = '~'; NAV = [{ v: 'brand', a: 'acme' }]; render(0);
    const o = { init: BR.theme, n: document.querySelectorAll('[data-a=brDs]').length, ok: [] };
    for (const t of ['a', 'b', 'c']) { document.querySelector(`[data-a=brDs][data-v=${t}]`).click(); o.ok.push(BR.theme === t && bzOk(brEff()) && document.querySelector('.brpv').dataset.ds === t); } return o; });
  check('7א מסך המיתוג: ערכת ברירת מחדל a (dark-gold); 3 אפשרויות; בחירה גוזרת צבעים תקינים ותצוגה מקדימה בערכה', br.init === 'a' && br.n === 3 && br.ok.every(Boolean), br);
  if (shots) for (const t of ['a', 'b', 'c']) for (const [ln, acc] of [['כתום', '#e0623a'], ['כחול', '#1d4ed8']]) {
    await page.evaluate(([t, acc]) => { BR.sugg = [{ n: 'מהלוגו', c: dsDerive(t, acc) }]; BR.colors = {}; BR.colors.acc = acc; BR.theme = t; BR.colors = dsDerive(t, acc); BR.custom = 1; brDraw(); }, [t, acc]);
    await H.settle(page, 300); await page.screenshot({ path: path.join(shots, `מיתוג-${t}-${ln}.png`), fullPage: true });
  }
  check('8 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors);
  await ctx.close();

  // ---- עובד: תמיד ברירת המחדל של העסק, אין בורר ----
  { const { ctx: c2, page: p2 } = await H.newPage(browser, src, cfg, [], 'w'); await p2.setViewportSize({ width: 390, height: 844 }); await H.login(p2, 'w@x.co');
    const w = await p2.evaluate(() => { localStorage.setItem(LK('lp-ds:w'), 'c'); SY.biz = Object.assign({}, SY.biz, { brand: { name: 'x', colors: {}, theme: 'b' } }); BZK = '~'; bzSkin(); return { ds: document.documentElement.dataset.ds, row: dsRow() }; });
    check('9 עובד: הבחירה האישית לא חלה (data-ds = ערכת העסק b) ואין בורר', w.ds === 'b' && w.row === '', w);
    check('9א אין שגיאות JS (עובד)', p2.__errors.length === 0, p2.__errors); await c2.close(); }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
