'use strict';
// בדיקת Playwright לממשק הקופה (pos-sale.js) – בתוך index.html האמיתי (file://), ברוחב 390 וברוחב 1280, בשלוש הערכות.
// הרצה: node tests/pos-ui.e2e.js   (צריך playwright מותקן; צילומי מסך נשמרים ב-POS_SHOTS אם הוגדר)
// בודק: פתיחה, חיפוש ב-5,000+ מוצרים, רשימה וירטואלית (מעט שורות ב-DOM), סורק כמקלדת, כמויות, תשלום מפוצל עם עודף,
// קבלה, החזרה, נתוני היום בפס העליון, אין הגדרות במסך הקופה, אין גלילה אופקית, אין צבע קבוע ב-pos.css.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const URL = 'file://' + path.join(__dirname, '../../app-source/www/index.html');
const SHOTS = process.env.POS_SHOTS || '';

async function scanKeys(page, code) {
  for (const ch of code) await page.keyboard.press(ch, { delay: 0 });
  await page.keyboard.press('Enter');
}
const txt = (page, sel) => page.locator(sel).first().innerText();

async function run(width, height, ds) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'he-IL' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('lp-pos', '1'); localStorage.removeItem('lp-pos-mock-v1'); } catch (e) {} });
  await page.goto(URL);
  await page.waitForFunction(() => typeof window.posOpen === 'function' && !!window.PosData);
  // מדמה משתמש מחובר: מסך הכניסה (body.gate) מסתיר את כל השאר
  await page.evaluate((t) => { document.body.classList.remove('gate', 'susp'); const g = document.getElementById('gate'); if (g) g.style.display = 'none'; document.documentElement.dataset.ds = t; }, ds);
  await page.evaluate(() => window.posOpen());
  await page.waitForSelector('#pos .pos-row');
  const tag = `${width}/${ds}`;

  // פס עליון: קופאי, משמרת, נתוני היום; בלי הגדרות
  const topT = await txt(page, '#posTop');
  assert.match(topT, /קופאי/, tag); assert.match(topT, /משמרת 1/, tag); assert.match(topT, /מכירות היום/, tag);
  assert.equal(await page.locator('#pos').getByText(/הגדרות/).count(), 0, tag + ' אין הגדרות בקופה');

  // רשימה וירטואלית: אלפי תוצאות, מעט שורות ב-DOM
  const rows = await page.locator('#pos .pos-row').count();
  assert.ok(rows > 0 && rows < 60, tag + ' rows=' + rows);
  const t0 = Date.now();
  await page.fill('#posQ', 'חלב');
  await page.waitForFunction(() => /תוצאות/.test(document.querySelector('#posCnt').textContent));
  const dt = Date.now() - t0;
  assert.ok(dt < 1000, tag + ' search ms=' + dt);
  await page.evaluate(() => { const v = document.querySelector('#posVl'); v.scrollTop = v.scrollHeight; });
  await page.waitForTimeout(80);
  assert.ok(await page.locator('#pos .pos-row').count() < 60, tag + ' after scroll');
  await page.fill('#posQ', '');
  await page.waitForFunction(() => document.querySelector('#posCnt').textContent === '');

  // סורק: הקלדה מהירה + Enter, בלי פוקוס בשדה
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await scanKeys(page, '7290000000015');
  await scanKeys(page, '7290000000015');
  await scanKeys(page, '7290000000022');
  if (width < 760) { await page.click('#posTabs [data-v=cart]'); }
  await page.waitForSelector('#pos .pos-line');
  assert.equal(await page.locator('#pos .pos-line').count(), 2, tag);
  assert.equal(await page.inputValue('#pos .pos-line[data-pid=p0] .pos-qn'), '2', tag);
  assert.equal((await txt(page, '#posTotal')).trim(), '₪22.30', tag); // 6.90×2 + 8.50
  assert.equal(await page.inputValue('#posQ'), '', tag + ' הסריקה לא נשארה בשדה החיפוש');
  assert.equal(await page.locator('#posCnt').innerText(), '', tag + ' החיפוש חזר לרשימה המלאה');
  // כמות: + ו-−
  await page.click('#pos .pos-line[data-pid=p00] [data-d="1"]');
  assert.equal((await txt(page, '#posTotal')).trim(), '₪30.80', tag);
  await page.click('#pos .pos-line[data-pid=p00] [data-d="-1"]');
  assert.equal((await txt(page, '#posTotal')).trim(), '₪22.30', tag);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `pos-sale-${width}-${ds}.png`) });

  // תשלום מפוצל: אשראי 10 ₪, מזומן 20 ₪ → עודף 7.70
  await page.click('#pos [data-pa=payOpen]');
  await page.waitForSelector('#payTotal');
  await page.click('#pos [data-pa=payM][data-v=credit]');
  await page.fill('#payInp', '50');
  await page.click('#pos [data-pa=payAdd]');
  assert.equal(await page.locator('#payChange').count(), 0, tag + ' אשראי מעל היתרה נדחה');
  await page.fill('#payInp', '10');
  await page.click('#pos [data-pa=payAdd]');
  assert.equal((await txt(page, '#payRem')).trim(), '₪12.30', tag);
  await page.click('#pos [data-pa=payM][data-v=cash]');
  await page.fill('#payInp', '20');
  await page.press('#payInp', 'Enter');
  assert.equal((await txt(page, '#payChange')).trim(), '₪7.70', tag);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `pos-pay-${width}-${ds}.png`) });
  await page.click('#pos [data-pa=payDone]');
  await page.waitForSelector('#rcptTotal');
  assert.equal((await txt(page, '#rcptTotal')).trim(), '₪22.30', tag);
  const rc = await txt(page, '#pos .pos-rcpt');
  assert.match(rc, /מע"מ 18%/, tag); assert.match(rc, /₪3.40/, tag); // 2230*18/118 = 340.2
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `pos-rcpt-${width}-${ds}.png`) });
  await page.click('#pos [data-pa=newSale]');
  assert.match(await txt(page, '#posTop'), /₪22.30/, tag + ' נתוני היום התעדכנו');

  // החזרה: יחידה אחת של חלב
  await page.click('#pos [data-pa=retOpen]');
  await page.click('#pos [data-pa=retPick][data-no="1"]');
  await page.click('#pos [data-pa=retQ][data-pid=p0][data-d="1"]');
  assert.equal((await txt(page, '#retTotal')).trim(), '₪6.90', tag);
  await page.click('#pos [data-pa=retDo]');
  await page.waitForSelector('#rcptTotal');
  assert.equal((await txt(page, '#rcptTotal')).trim(), '₪6.90', tag);
  await page.click('#pos [data-pa=newSale]');
  assert.match(await txt(page, '#posTop'), /₪15.40/, tag);

  // מסך לקוח
  await scanKeys(page, '7290000000022');
  await page.click('#pos [data-pa=custT]');
  await page.waitForSelector('#pcTotal');
  assert.equal((await txt(page, '#pcTotal')).trim(), '₪8.50', tag);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `pos-cust-${width}-${ds}.png`) });
  if (width < 1100) await page.click('#posCust'); else await page.click('#pos [data-pa=custT]');

  // בלי גלילה אופקית; יציאה עם סל פתוח מבקשת אישור
  const ov = await page.evaluate(() => document.querySelector('#pos').scrollWidth - document.querySelector('#pos').clientWidth);
  assert.ok(ov <= 0, tag + ' overflow ' + ov);
  await page.click('#pos [data-pa=exit]');
  await page.click('#pos [data-pa=askYes]');
  assert.equal(await page.locator('#pos').count(), 0, tag);
  assert.deepEqual(errs.filter((e) => /pos/i.test(e)), [], tag + ' שגיאות JS');
  await browser.close();
}

(async () => {
  const css = fs.readFileSync(path.join(__dirname, '../../app-source/www/pos.css'), 'utf8');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css), 'pos.css: אין צבע קבוע');
  for (const w of [[390, 844], [1280, 800]]) for (const ds of ['a', 'b', 'c']) { await run(w[0], w[1], ds); console.log('ok', w[0], ds); }
  console.log('PASS');
})().catch((e) => { console.error(e); process.exit(1); });
