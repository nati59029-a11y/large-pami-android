'use strict';
// ריבוי עסקים, שלב 6ב: לארג' פעמי (מצב legacy, כל תשע התוספות מופעלות) – צילום המסכים הראשיים ברוחב 360px מ-main ומהענף,
// בשלוש ערכות: ברירת המחדל, "לוגו" ו"לילה" (הכהה שבערכות הקלאסיות), והשוואה בתים-לבתים. לא צריך אמולטור.
// node ui-brand-shots.js <www-main> <www-branch> <out-dir>
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
(async () => {
  const [wm, wb, dir] = process.argv.slice(2); fs.mkdirSync(dir, { recursive: true });
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } }; const browser = await H.launch(); let bad = 0;
  const THEMES = [['default', null], ['logo', 'logo'], ['night', 'night']];
  const SCR = [['home', () => { NAV = [{ v: 'home' }]; render(0); }], ['inc', () => { NAV = [{ v: 'inc' }]; render(0); }], ['exp', () => { NAV = [{ v: 'exp' }]; render(0); }], ['rep', () => { RS = scopeOf('all:exp'); NAV = [{ v: 'home' }]; go('rep'); }], ['settings', () => { NAV = [{ v: 'settings' }]; render(0); }], ['more', () => { NAV = [{ v: 'more' }]; render(0); }]];
  const WSCR = [['wk-home', () => { WS = 'home'; render(0); }], ['wk-exp', () => { WS = 'exp'; render(0); }]];
  const shootW = async (www) => { // עובד של לארג' פעמי: מסך הבית (אריחי התוספות) ומסך ההוצאה
    const r = {}; const { ctx, page } = await H.newPage(browser, www, cfg, [], 'w'); await page.setViewportSize({ width: 360, height: 740 }); await H.login(page, 'w@x.co'); await H.settle(page, 1000);
    for (const [n, f] of WSCR) { await page.evaluate(f); await H.settle(page, 1200); r[n] = await page.screenshot({ fullPage: true }); r[n + '-html'] = await page.evaluate(() => document.getElementById('main').innerHTML); }
    r.errors = page.__errors; await ctx.close(); return r;
  };
  const shoot = async (www) => {
    const r = {}; const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 }); await H.login(page, 'm@x.co');
    const sample = await page.evaluate(() => { const s = document.getElementById('sheet'); const t = s && !s.hidden ? s.innerText : ''; if (s && !s.hidden) ACT.startBlank(); return t; }); r.welcome = sample; await H.settle(page, 800);
    for (const [tn, tv] of THEMES) for (const [n, f] of SCR) { await page.evaluate((v) => { S.theme = v || 'paper'; }, tv); await page.evaluate(f); await H.settle(page, 1200); r[tn + '-' + n] = await page.screenshot({ fullPage: true }); }
    r.errors = page.__errors; await ctx.close(); return r;
  };
  const a = await shoot(wm), b = await shoot(wb), aw = await shootW(wm), bw = await shootW(wb);
  for (const [n] of WSCR) { const same = Buffer.compare(aw[n], bw[n]) === 0 && aw[n + '-html'] === bw[n + '-html']; if (!same) bad++; fs.writeFileSync(path.join(dir, 'main-' + n + '.png'), aw[n]); fs.writeFileSync(path.join(dir, 'branch-' + n + '.png'), bw[n]); console.log((same ? 'זהה  ' : 'שונה ') + n + ' (צילום וגם HTML)'); }
  a.errors = a.errors.concat(aw.errors); b.errors = b.errors.concat(bw.errors);
  console.log('מסך "ברוך הבא" אצל לארג\' פעמי כולל "נתוני דוגמה": main=' + /נתוני דוגמה/.test(a.welcome) + ' ענף=' + /נתוני דוגמה/.test(b.welcome));
  if (/נתוני דוגמה/.test(a.welcome) !== /נתוני דוגמה/.test(b.welcome)) bad++;
  for (const [tn] of THEMES) for (const [n] of SCR) {
    const k = tn + '-' + n; const same = Buffer.compare(a[k], b[k]) === 0; if (!same) bad++;
    fs.writeFileSync(path.join(dir, 'main-' + k + '.png'), a[k]); fs.writeFileSync(path.join(dir, 'branch-' + k + '.png'), b[k]); console.log((same ? 'זהה  ' : 'שונה ') + k);
  }
  console.log('שגיאות JS main/branch:', JSON.stringify(a.errors), JSON.stringify(b.errors)); await browser.close(); console.log(bad ? 'תוצאה: יש הבדלים' : 'תוצאה: כל המסכים זהים'); process.exit(bad || b.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
