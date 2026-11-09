'use strict';
// ריבוי עסקים, שלב 7: בדיקות דפדפן עם רשת מדומה (לא צריך אמולטור):
// לוגו אחרון במסך הכניסה (lp-lastlogo), לוגו APK של עסק (LP_BIZ), צבע הודעת המידע, orders/app.html בכתובת ישירה כשהתוספת כבויה,
// מתג "הזמנות" אצל עובד, ומסכים ב-5 גדלים (1366×768 ועוד 4) בלי גלילה רוחבית.
// שימוש: node ui-7.js <www-dir> <out.json> [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
// png תקין קטן (4x4 אדום)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAQMAAACTPww9AAAAA1BMVEX/AAAZ4gk3AAAAC0lEQVQI12NgQAcAABQAAWJcPPEAAAAASUVORK5CYII=';

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const legacy = { mode: 'old', admins: { '|m': 1 }, staff: { '|w': 1 } };
  const bcfg = { mode: 'new', users: { ma: 'acme', wa: 'acme' }, biz: { acme: { dataRoot: 'b', features: { orders: true, tasks: true } } }, admins: { 'b/acme/|ma': 1 }, staff: { 'b/acme/|wa': 1 } };
  const gate = (page) => page.evaluate(() => ({ img: (document.querySelector('#gate .glogo img') || {}).src || '', name: (document.querySelector('#gate .gh b') || {}).textContent || '' }));

  // 1. מסך כניסה בטלפון חדש = הלוגו הרגיל ו"לארג׳ פעמי"
  { const { ctx, page } = await H.newPage(browser, www, legacy, [], 'g0'); await page.goto(H.ORIGIN + '/?emu=1'); await page.waitForSelector('#gform');
    const g = await gate(page); check('1 טלפון חדש: מסך הכניסה עם הלוגו הרגיל והשם "לארג׳ פעמי"', !/^data:image\/png;base64,iVBOR/.test(g.img) && g.name === 'לארג׳ פעמי', { name: g.name, img: g.img.slice(0, 30) });
    // 2. lp-lastlogo שמור: הלוגו והשם של העסק האחרון
    await page.evaluate((u) => localStorage.setItem('lp-lastlogo', JSON.stringify({ u: 'data:image/png;base64,' + u, n: 'מאפיית אקמי', b: 'acme' })), PNG);
    await page.reload(); await page.waitForSelector('#gform');
    const g2 = await gate(page); await shot(page, '01-כניסה-לוגו-אחרון');
    check('2 lp-lastlogo שמור: מסך הכניסה מציג את הלוגו ואת שם העסק האחרון', g2.img === 'data:image/png;base64,' + PNG && g2.name === 'מאפיית אקמי', { name: g2.name });
    // 3. ערך זדוני ב-lp-lastlogo נדחה (לא data:image, או שם עם HTML)
    await page.evaluate(() => localStorage.setItem('lp-lastlogo', JSON.stringify({ u: 'javascript:alert(1)', n: '<img src=x onerror=alert(1)>' })));
    await page.reload(); await page.waitForSelector('#gform');
    const g3 = await gate(page); const inj = await page.evaluate(() => !!document.querySelector('#gate img[src=x]'));
    check('3 lp-lastlogo לא תקין: חוזרים ללוגו הרגיל, ואין הזרקת HTML', !/javascript:/.test(g3.img) && !inj && g3.name === 'לארג׳ פעמי', g3);
    check('3א אין שגיאות JS במסך הכניסה', page.__errors.length === 0, page.__errors);
    await ctx.close(); }

  // 4. APK של עסק (window.LP_BIZ): בלי lp-lastlogo – הלוגו והשם של ה-APK
  { const { ctx, page } = await H.newPage(browser, www, legacy, [], 'g1');
    await page.addInitScript((u) => { window.LP_BIZ = { id: 'acme', name: 'אקמי', logo: 'data:image/png;base64,' + u }; }, PNG);
    await page.goto(H.ORIGIN + '/?emu=1'); await page.waitForSelector('#gform');
    const g = await gate(page); await shot(page, '02-כניסה-APK-עסק');
    check('4 APK של עסק בטלפון חדש: מסך הכניסה מציג את הלוגו והשם של ה-APK', g.img === 'data:image/png;base64,' + PNG && g.name === 'אקמי', { name: g.name });
    // 5. צבע הודעת המידע ("שלחנו קישור") שונה מצבע השגיאה
    const col = await page.evaluate(() => { const f = document.getElementById('gform'); const p = document.createElement('p'); p.className = 'gerr ginfo'; f.append(p); const q = document.createElement('p'); q.className = 'gerr'; f.append(q); const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--inc'); document.body.append(d); const inc = getComputedStyle(d).color; d.remove(); return [getComputedStyle(p).color, getComputedStyle(q).color, inc]; });
    /* D2: הצבע נגזר מהערכה (--inc), לא קבוע; הערכה כהה → ירוק בהיר, ערכה בהירה → ירוק כהה */
    const gr = (/(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(col[0]) || []).slice(1).map(Number);
    check('5 הודעת מידע במסך הכניסה בצבע ירוק (צבע ההכנסה של הערכה), לא בצבע השגיאה האדום', col[0] !== col[1] && col[0] === col[2] && gr[1] > gr[0] && gr[1] > gr[2], col);
    await ctx.close(); }

  // 4ב. האפליקציה הכללית "ניהול עסק" (make-biz-app.sh business כותב LP_BIZ עם השם הכללי): במסך הכניסה אין "לארג"
  { const { ctx, page } = await H.newPage(browser, www, legacy, [], 'g1b');
    await page.addInitScript((u) => { window.LP_BIZ = { id: 'business', name: 'ניהול עסק', logo: 'data:image/png;base64,' + u }; }, PNG);
    await page.goto(H.ORIGIN + '/?emu=1'); await page.waitForSelector('#gform');
    const g = await gate(page), txt = await page.evaluate(() => document.getElementById('gate').innerText + ' ' + (document.querySelector('#gate .glogo img') || {}).alt);
    check('4ב אפליקציה כללית: מסך הכניסה "ניהול עסק" בלי "לארג" ובלי הלוגו של לארג׳ פעמי', g.name === 'ניהול עסק' && !/לארג/.test(txt) && g.img === 'data:image/png;base64,' + PNG, { name: g.name, txt: txt.slice(0, 200) });
    await ctx.close(); }

  // 6. orders/app.html בכתובת ישירה כשהתוספת כבויה (site-backend = off, בלי emu)
  { const { ctx, page } = await H.newPage(browser, www, legacy, [], 'ord'); const reqs = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (u.port !== '8491') reqs.push(r.url()); });
    await page.goto(H.ORIGIN + '/orders/app.html'); await H.settle(page, 2500);
    const t = await page.evaluate(() => document.body.innerText);
    await shot(page, '03-הזמנות-כבוי');
    check('6 orders/app.html בכתובת ישירה כשהלשונית כבויה: הודעה "כבויה", ואין שום בקשה לשרת חיצוני', /כבויה/.test(t) && reqs.length === 0, { text: t.slice(0, 120), reqs: reqs.slice(0, 5) });
    await ctx.close(); }

  // 7. מתג "הזמנות" אצל עובד: בלי ord – אין כפתור, ו-ACT.ordGo לא מנווט
  { const { ctx, page } = await H.newPage(browser, www, bcfg, [], 'wa'); await H.login(page, 'wa@x.co');
    const r = await page.evaluate(() => { SY.perms = { incW: true, expR: true, expW: true, sup: true, ord: false }; const before = location.href; ACT.ordGo(); return { role: SY.role, b: bzB(), stay: location.href === before }; });
    await H.settle(page, 800);
    check('7 עובד בלי מתג "הזמנות": ACT.ordGo לא פותח את orders/app.html', r.role === 'worker' && r.b && r.stay && !/orders\/app\.html/.test(page.url()), r);
    await ctx.close(); }

  // 9. 6ו: מסכי עובד לפי המתגים (הכנסות, משכורות, דוחות), "רואה רק את שלו", חלון ההרשאות, והזמנות בכתובת ישירה
  { const { ctx, page } = await H.newPage(browser, www, bcfg, [], 'wv'); await page.setViewportSize({ width: 360, height: 740 }); await H.login(page, 'wa@x.co');
    const r = await page.evaluate(() => { SY.perms = { incR: true, incW: false, expR: 'own', expW: true, sup: false, sal: false, rep: true, ord: false, trf: false }; WS = 'home'; NAV = [{ v: 'wk' }]; render(0);
      const ks = [...document.querySelectorAll('[data-a=wvGo]')].map((b) => b.dataset.k); const e = wpE(); ACT.wvGo({ dataset: { k: 'sal' } }); const salWs = WS;
      return { ks, e, salWs, sent: /ההוצאות ששלחתי/.test(document.body.innerText) }; });
    check('9 עובד: מוצגים רק המסכים שהמתג שלהם פתוח (הכנסות, דוחות – לא משכורות); "רק שלו" רואה את ההוצאות ששלח', r.ks.join() === 'inc,rep' && r.e === 'own' && r.salWs === 'home' && r.sent, r);
    await page.evaluate(() => ACT.wvGo({ dataset: { k: 'inc' } })); await H.settle(page, 1200);
    const v = await page.evaluate(() => ({ ws: WS, t: document.body.innerText.slice(0, 400), ov: document.documentElement.scrollWidth - innerWidth }));
    await shot(page, '05-עובד-הכנסות');
    check('9א מסך הכנסות לעובד נפתח (קריאה בלבד), בלי גלילה רוחבית ובלי שגיאות JS', v.ws === 'wv' && /הכנסות/.test(v.t) && /קריאה בלבד/.test(v.t) && v.ov <= 1 && page.__errors.length === 0, { ov: v.ov, err: page.__errors, t: v.t.slice(0, 120) });
    const pm = await page.evaluate(() => [pmRead({ p_expR: 'own', p_sal: '1' }).expR, pmRead({ p_expR: 'all' }).expR, pmRead({ p_expR: 'none' }).expR, pmRead({ p_expR: 'none', p_sal: '1' }).sal, /<select name="p_expR">/.test(pmBoxes({ expR: 'own' })), /value="own" selected/.test(pmBoxes({ expR: 'own' }))]);
    check('9ב חלון ההרשאות: "רואה הוצאות" בשלוש אפשרויות בשדה אחד (own / true / false)', pm[0] === 'own' && pm[1] === true && pm[2] === false && pm[3] === true && pm[4] && pm[5], pm);
    await page.evaluate(() => syS());
    await page.goto(H.ORIGIN + '/orders/app.html?emu=1'); await H.settle(page, 1500);
    const ot = await page.evaluate(() => document.body.innerText);
    check('9ג orders/app.html בכתובת ישירה, עובד בלי מתג "הזמנות": נחסם', /אין לך הרשאה להזמנות/.test(ot), ot.slice(0, 120));
    await ctx.close(); }

  // 8. 5 גדלי מסך: אין גלילה רוחבית במסכים העיקריים של מנהל במצב b
  const SIZES = [[1366, 768], [1920, 1080], [1024, 768], [768, 1024], [360, 740]];
  for (const [w, h] of SIZES) {
    const { ctx, page } = await H.newPage(browser, www, bcfg, [], 'ma' + w); await page.setViewportSize({ width: w, height: h });
    await page.goto(H.ORIGIN + '/?emu=1'); await page.waitForSelector('#gform');
    const gw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await H.login(page, 'ma@x.co'); await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
    const bad = {};
    for (const v of ['home', 'more', 'settings', 'staff', 'reports']) { await page.evaluate((x) => { NAV = [{ v: 'home' }].concat(x === 'home' ? [] : [{ v: x }]); render(0); }, v); await H.settle(page, 600);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) bad[v] = o; if (v === 'home' || v === 'settings') await shot(page, `04-${w}x${h}-${v}`); }
    check(`8 ${w}×${h}: מסך כניסה, בית, עוד, הגדרות, עובדים ודוחות בלי גלילה רוחבית ובלי שגיאות JS`, gw <= 1 && !Object.keys(bad).length && page.__errors.length === 0, { gate: gw, bad, err: page.__errors });
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
