'use strict';
// ריבוי עסקים, שלב 6א: צילום המסכים הראשיים ברוחב 360px (לארג' פעמי, מצב legacy, חוקים ישנים) והשוואה בין main לענף. לא צריך אמולטור.
// node ui-admin-shots.js <www-main> <www-branch> <out-dir>
const fs = require('fs'); const path = require('path'); const H = require('./harness');
(async () => {
  const [wm, wb, dir] = process.argv.slice(2); fs.mkdirSync(dir, { recursive: true });
  const cfg = { mode: 'old', admins: { '|m': 1 }, staff: { '|w': 1 } }; const browser = await H.launch(); let bad = 0;
  const SCR = [['home', () => { NAV = [{ v: 'home' }]; render(0); }], ['inc', () => { NAV = [{ v: 'inc' }]; render(0); }], ['exp', () => { NAV = [{ v: 'exp' }]; render(0); }], ['rep', () => { RS = scopeOf('all:exp'); NAV = [{ v: 'home' }]; go('rep'); }], ['settings', () => { NAV = [{ v: 'settings' }]; render(0); }]];
  const shoot = async (www) => { const r = {}; const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 }); await H.login(page, 'm@x.co');
    await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 800);
    for (const [n, f] of SCR) { await page.evaluate(f); await H.settle(page, 1500); r[n] = await page.screenshot({ fullPage: true }); }
    r.errors = page.__errors; await ctx.close(); return r; };
  const a = await shoot(wm), b = await shoot(wb);
  for (const [n] of SCR) { const same = Buffer.compare(a[n], b[n]) === 0; if (!same) bad++; fs.writeFileSync(path.join(dir, 'main-' + n + '.png'), a[n]); fs.writeFileSync(path.join(dir, 'branch-' + n + '.png'), b[n]); console.log((same ? 'זהה  ' : 'שונה ') + n); }
  console.log('שגיאות JS main/branch:', JSON.stringify(a.errors), JSON.stringify(b.errors)); await browser.close(); console.log(bad ? 'תוצאה: יש הבדלים' : 'תוצאה: כל המסכים זהים'); process.exit(bad || b.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
