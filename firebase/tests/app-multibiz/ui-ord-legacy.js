'use strict';
// הזמנות שלב 1 בלארג' פעמי במצב legacy (נתונים בשורש): אריח לעובד, רשת אריחים זוגית, המסכים קוראים מהשורש (לא מ-b/).
// רשת מדומה. שימוש: node ui-ord-legacy.js <www-dir>
const H = require('./harness');
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 300) : '')); };
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
(async () => {
  const [www] = process.argv.slice(2);
  const browser = await H.launch();
  for (const who of ['w', 'm']) {
    const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1, '|m': 1 } };
    const log = []; const { ctx, page } = await H.newPage(browser, www, cfg, log, who);
    const rq = [];
    await ctx.route(/:8080\/.*/, (route) => { const b = route.request().postData() || ''; if (/:runQuery$/.test(new URL(route.request().url()).pathname)) rq.push(route.request().url() + ' ' + b); return route.fallback(); });
    await H.login(page, who + '@x.co'); await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); }); await H.settle(page, 500);
    const boot = rq.filter((x) => /"(ord|prod|ordpay|stockLog)"/.test(x)).length;
    check(`${who}: בכניסה – אין שום בקשת הזמנות (התנהגות קיימת לא השתנתה)`, boot === 0, boot);
    if (who === 'w') {
      const g = await page.evaluate(() => { const t = [...document.querySelectorAll('#main .big2 > .tile')]; return { n: t.length, ox: !!document.querySelector('#main .big2 [data-v=ox]') }; });
      check('w: אריח "הזמנות" מופיע, ומספר האריחים ברשת זוגי', g.ox && g.n % 2 === 0, g);
    }
    await page.evaluate((w) => { NAV = [{ v: w === 'w' ? 'wk' : 'home' }]; go('ox'); }, who);
    await H.settle(page, 800);
    const q = rq.filter((x) => /"ord"/.test(x));
    const txt = await page.evaluate(() => document.querySelector('#main').innerText);
    check(`${who}: מסך הזמנות נפתח וקורא מהשורש (לא מ-b/)`, q.length > 0 && q.every((x) => /\/documents:runQuery/.test(x) && !/\/documents\/b\//.test(x)) && /הזמנה חדשה/.test(txt), { q: q.slice(0, 1), txt: txt.slice(0, 60) });
    check(`${who}: בלי שגיאות JS`, page.__errors.length === 0, page.__errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `נכשלו ${fail}` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
