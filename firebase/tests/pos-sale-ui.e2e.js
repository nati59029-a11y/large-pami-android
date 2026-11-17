'use strict';
// ש1 – בדיקת Playwright לממשק המכירה והתשלום, בתוך index.html האמיתי (file://), ברוחב 390 (מאונך) וברוחב 1280 (מאוזן), בשלוש הערכות.
// הרצה: node tests/pos-sale-ui.e2e.js   (צריך playwright; צילומי מסך נשמרים בתיקייה POS_SHOTS אם הוגדרה)
// מכסה (צד הממשק): ב 5.2–5.6, 5.10, 5.14 · ד U1, U2/U10, U5, U6, U12, H9/U17 · ה 5.10 · א 5.7–5.9.
const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const URL = 'file://' + path.join(__dirname, '../../app-source/www/index.html');
const SHOTS = process.env.POS_SHOTS || '';

async function scan(page, code) { for (const ch of code) await page.keyboard.press(ch, { delay: 0 }); await page.keyboard.press('Enter'); await page.waitForTimeout(60); }
const txt = (page, sel) => page.locator(sel).first().innerText();
const modal = '#pos .pos-modal';

async function run(width, height, ds, role) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'he-IL' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript((r) => { try { localStorage.removeItem('lp-pos-mock-v2'); localStorage.setItem('lp-pos-mock-role', r); } catch (e) {} }, role);
  await page.goto(URL);
  await page.waitForFunction(() => typeof window.posOpen === 'function' && !!window.PosData && !!window.PosCalc);
  // מדמה משתמש מחובר: מסך הכניסה (body.gate) מסתיר את כל השאר
  await page.evaluate((t) => { document.body.classList.remove('gate', 'susp'); const g = document.getElementById('gate'); if (g) g.style.display = 'none'; document.documentElement.dataset.ds = t; }, ds);
  await page.evaluate(() => window.posOpen());
  await page.waitForSelector('#pos .pos-row');
  const tag = `${width}/${ds}/${role}`;
  const tot = async () => (await txt(page, '#posTotal')).trim();

  // פס עליון ותפריט; אין הגדרות (ה 5.10)
  const topT = await txt(page, '#posTop');
  for (const w of ['קופאי 7', 'משמרת 1', 'מכירה', 'החזרה', 'השהיות', 'המכירות שלי']) assert.ok(topT.includes(w), tag + ' ' + w);
  assert.equal(await page.locator('#pos').getByText(/הגדרות/).count(), 0, tag + ' אין הגדרות בקופה');

  // רשימה וירטואלית וחיפוש (ס4)
  await page.click('#posCats [data-v=milk]');
  assert.ok(await page.locator('#pos .pos-row').count() < 60, tag + ' virtual');
  await page.fill('#posQ', 'חלב');
  await page.waitForFunction(() => /תוצאות/.test(document.querySelector('#posCnt').textContent));
  assert.ok(await page.locator('#pos .pos-row').count() <= 10, tag + ' searchMax');
  await page.fill('#posQ', 'תנוכה');
  await page.waitForFunction(() => [...document.querySelectorAll('#pos .pos-row')].some((r) => r.textContent.includes('חלב תנובה')));
  await page.fill('#posQ', '');

  // סורק (H9): בלי פוקוס בשדה
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await scan(page, '7290000000015'); await scan(page, '7290000000015'); await scan(page, '7290000000022');
  assert.equal(await page.locator('#pos .pos-line').count(), 2, tag);
  assert.equal(await tot(), '₪22.30', tag);
  assert.equal(await page.inputValue('#posQ'), '', tag + ' הסריקה לא נשארה בשדה');
  // "בטל" אחרי הוספה (U6)
  await scan(page, '7290000000022');
  assert.equal(await tot(), '₪30.80', tag);
  await page.click('#pos [data-pa=undo]');
  assert.equal(await tot(), '₪22.30', tag + ' undo');
  // מחיקת שורה עם אישור (ס5, U6) + יומן
  await page.click('#pos .pos-line:has-text("לחם") [data-pa=del]');
  await page.waitForSelector(modal);
  await page.click(`${modal} [data-v=yes]`);
  assert.equal(await page.locator('#pos .pos-line').count(), 1, tag);
  assert.ok(await page.evaluate(() => PosData.getLog().then((L) => L.some((x) => x.act === 'lineDel'))), tag + ' lineDel');
  // מלאי 0 – הודעה, המכירה ממשיכה (ב 5.3)
  await scan(page, '7290000000039');
  await page.waitForSelector('#pos .pos-toast.warn');
  assert.equal(await tot(), '₪43.70', tag);
  // הקלדת כמות (ס5)
  const qn = page.locator('#pos .pos-line:has-text("חלב") .pos-qn');
  await qn.fill('3'); await qn.press('Enter');
  assert.equal(await tot(), '₪50.60', tag);

  // הנחה ידנית (ב 5.14): לקופאי אין כפתור; לאחראי 10% בלי אישור ו-11% דורש מנהל
  if (role === 'cashier') assert.equal(await page.locator('#pos [data-pa=disc]').count(), 0, tag + ' אין הנחה לקופאי');
  else {
    await page.click('#pos [data-pa=disc]'); await page.click(`${modal} [data-sc=all]`); await page.fill('#dPct', '11'); await page.click(`${modal} [data-v=ok]`);
    await page.waitForSelector(`${modal} .pos-ask`); assert.match(await txt(page, `${modal} .pos-ask`), /מנהל/, tag); await page.click(`${modal} [data-v=no]`);
    await page.click('#pos [data-pa=disc]'); await page.click(`${modal} [data-sc=all]`); await page.fill('#dPct', '10'); await page.click(`${modal} [data-v=ok]`);
    assert.equal(await page.locator(modal).count(), 0, tag + ' 10% בלי אישור');
    assert.equal(await tot(), '₪45.54', tag); // 5060 − 506
    await page.click('#pos [data-pa=undisc]');
    assert.equal(await tot(), '₪50.60', tag);
  }
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `s1-sale-${width}-${ds}.png`) });

  // תשלום משולב (ב 5.5–5.6): אף אמצעי לא מסומן; ביט בלי אסמכתא נחסם; אשראי מעל היתרה נחסם; מזומן עם עודף סוגר
  await page.click('#posPay');
  await page.waitForSelector('#payTotal');
  assert.equal(await page.locator(`${modal} .pos-m[aria-pressed=true]`).count(), 0, tag + ' אף אמצעי לא נבחר');
  await page.click(`${modal} [data-pa=m][data-v=bit]`); await page.fill('#payAmt', '10'); await page.click(`${modal} [data-pa=add]`);
  await page.waitForSelector(`${modal} .pos-err`); assert.match(await txt(page, `${modal} .pos-err`), /אסמכתא/, tag);
  await page.fill('#payAmt', '10'); await page.fill('#payRef', '88231'); await page.click(`${modal} [data-pa=add]`);
  assert.equal((await txt(page, '#payRem')).trim(), '₪40.60', tag);
  await page.click(`${modal} [data-pa=m][data-v=card]`); await page.fill('#payAmt', '100'); await page.fill('#payL4', '1234'); await page.fill('#payAppr', '555'); await page.click(`${modal} [data-pa=add]`);
  await page.waitForSelector(`${modal} .pos-err`); assert.match(await txt(page, `${modal} .pos-err`), /גבוה מהיתרה/, tag);
  assert.ok(await page.locator(`${modal} [data-pa=fin]`).isDisabled(), tag + ' סיום לא פעיל עם יתרה');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `s1-pay-${width}-${ds}.png`) });
  await page.click(`${modal} [data-pa=m][data-v=cash]`); await page.click(`${modal} [data-pa=q][data-v="5000"]`);
  await page.waitForSelector('#posChg');
  assert.equal((await txt(page, '#posChg')).trim(), '₪9.40', tag); // 5000 − 4060
  assert.equal(await page.evaluate(() => PosUI.UI.printed.length), 1, tag + ' קבלה הודפסה אוטומטית');
  assert.equal(await page.evaluate(() => PosUI.UI.drawer.length), 1, tag + ' מגירה נפתחה במזומן');
  assert.equal(await page.locator('#pos .pos-line').count(), 0, tag + ' מסך נקי');

  // U1: 3 פריטים במזומן – 3 לחיצות אחרי הסריקה
  await scan(page, '7290000000015'); await scan(page, '7290000000022'); await scan(page, '7290000000015');
  await page.click('#posPay'); await page.click(`${modal} [data-pa=m][data-v=cash]`); await page.click(`${modal} [data-pa=q]`);
  await page.waitForSelector('#posChg');
  assert.equal((await txt(page, '#posChg')).trim(), '₪0.00', tag);

  // מכירה אחרונה: מע"מ, מספר קופאי; קבלת מתנה – בלי מחירים (ב 5.10)
  await page.click('#pos [data-pa=last]');
  const rc = await txt(page, `${modal} .pos-rcpt`);
  assert.match(rc, /מע"מ 18%/, tag); assert.match(rc, /קופאי 7/, tag); assert.match(rc, /₪22.30/, tag);
  await page.click(`${modal} [data-v=gift]`);
  await page.waitForSelector(`${modal} .pos-rcpt.gift`);
  assert.ok(!(await txt(page, `${modal} .pos-rcpt.gift`)).includes('₪'), tag + ' קבלת מתנה בלי מחירים');
  await page.click(`${modal} [data-v=no]`);

  // השהיה ושחזור (ב 5.2)
  await scan(page, '7290000000022');
  await page.click('#pos [data-pa=park]'); await page.fill('#kName', 'לקוח ממתין'); await page.click(`${modal} [data-v=ok]`);
  assert.equal(await page.locator('#pos .pos-line').count(), 0, tag);
  assert.match(await txt(page, '#posTop'), /השהיות\s*1/, tag);
  await page.click('#pos [data-pa=nav][data-v=park]'); await page.click(`${modal} .pos-pick`);
  assert.equal(await tot(), '₪8.50', tag);
  // ביטול עגלה בלי אישור + יומן (ב 5.2)
  await page.click('#pos [data-pa=clear]');
  assert.equal(await page.locator(modal).count(), 0, tag + ' בלי אישור');
  assert.equal(await page.locator('#pos .pos-line').count(), 0, tag);
  assert.ok(await page.evaluate(() => PosData.getLog().then((L) => L.some((x) => x.act === 'cartClear'))), tag + ' cartClear');

  // וריאציה (א 5.9) וברקוד לא מוכר – הוספה מהירה (א 5.7)
  await scan(page, '7290000000046');
  await page.waitForSelector(`${modal} .pos-pick`); await page.click(`${modal} .pos-pick:has-text("בינוני")`);
  assert.ok((await txt(page, '#posLines')).includes('סינר מטבח – בינוני'), tag);
  await scan(page, '7299999999990');
  await page.waitForSelector('#uName'); await page.fill('#uName', 'מוצר חדש'); await page.fill('#uAmt', '12'); await page.click(`${modal} [data-v=ok]`);
  await page.waitForFunction(() => document.querySelector('#posLines').textContent.includes('מוצר חדש'));
  assert.equal(await tot(), '₪51.90', tag); // 39.90 + 12
  // סכום חופשי – מחיר ידני רק בשורת מוצר כללי (א 5.8)
  await page.click('#posCats [data-v=fav]'); await page.click('#pos .pos-row:has-text("סכום חופשי")');
  await page.fill('#fAmt', '5'); await page.click(`${modal} [data-v=ok]`);
  assert.equal(await page.locator('#pos [data-pa=price]').count(), 1, tag + ' שינוי מחיר רק בפריט כללי');
  await page.click('#pos [data-pa=clear]');

  // החזרה בסיסית: קבלה 1, יחידת חלב אחת
  await page.click('#pos [data-pa=nav][data-v=ret]');
  await page.waitForSelector(`${modal} [data-pa=pick][data-no="1"]`); await page.click(`${modal} [data-pa=pick][data-no="1"]`);
  await page.click(`${modal} .pos-line:has-text("חלב") [data-pa=rq][data-d="1"]`);
  assert.equal((await txt(page, '#retTotal')).trim(), '₪6.90', tag);
  await page.selectOption('#retWhy', { index: 1 }); await page.check('#retTag');
  await page.click(`${modal} [data-pa=do]`);
  if (role === 'cashier') { await page.waitForSelector(`${modal} .pos-ask`); await page.click(`${modal} [data-v=yes]`); }
  await page.waitForFunction(() => !document.querySelector('#pos .pos-modal'));
  assert.ok(await page.evaluate(() => PosUI.UI.printed.some((p) => p.kind === 'ret')), tag + ' החזרה הודפסה');

  // מסך לקוח
  await scan(page, '7290000000022');
  await page.click('#pos [data-pa=custT]');
  await page.waitForSelector('#pcTotal');
  assert.equal((await txt(page, '#pcTotal')).trim(), '₪8.50', tag);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `s1-cust-${width}-${ds}.png`) });
  if (width < 1100) await page.click('#posCust'); else await page.click('#pos [data-pa=custT]');

  // U2/U10: כל כפתור לפחות 52px (חוץ מקישורי טקסט), ולכל כפתור שם נגיש; בלי גלילה אופקית
  const bad = await page.evaluate(() => [...document.querySelectorAll('#pos button')].filter((b) => b.offsetParent && !b.classList.contains('pos-lnk') && b.getBoundingClientRect().height < 51.5).map((b) => b.textContent.trim().slice(0, 20)));
  assert.deepEqual(bad, [], tag + ' כפתורים קטנים');
  const noName = await page.evaluate(() => [...document.querySelectorAll('#pos button')].filter((b) => b.offsetParent && !(b.getAttribute('aria-label') || b.textContent.trim())).length);
  assert.equal(noName, 0, tag + ' כפתור בלי שם');
  const ov = await page.evaluate(() => document.querySelector('#pos').scrollWidth - document.querySelector('#pos').clientWidth);
  assert.ok(ov <= 0, tag + ' overflow ' + ov);
  // הגדלת טקסט ל-21px לא שוברת את המסך
  await page.evaluate(() => { document.documentElement.dataset.fs = '3'; });
  const ov2 = await page.evaluate(() => document.querySelector('#pos').scrollWidth - document.querySelector('#pos').clientWidth);
  assert.ok(ov2 <= 0, tag + ' overflow בטקסט גדול ' + ov2);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `s1-big-${width}-${ds}.png`) });

  // יציאה עם עגלה – אישור
  await page.click('#pos [data-pa=exit]'); await page.click(`${modal} [data-v=yes]`);
  await page.waitForFunction(() => !document.querySelector('#pos'));
  assert.deepEqual(errs.filter((e) => /pos|Pos/.test(e)), [], tag + ' שגיאות JS');
  await browser.close();
}

(async () => {
  const runs = [[390, 844, 'a', 'cashier'], [390, 844, 'b', 'lead'], [390, 844, 'c', 'cashier'], [1280, 800, 'a', 'lead'], [1280, 800, 'b', 'cashier'], [1280, 800, 'c', 'lead']];
  for (const [w, h, ds, role] of runs) { await run(w, h, ds, role); console.log('ok', w, ds, role); }
  console.log('PASS');
})().catch((e) => { console.error(e); process.exit(1); });
