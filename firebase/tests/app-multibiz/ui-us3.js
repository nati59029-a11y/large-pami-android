'use strict';
// סריקה אחידה, שלב 3: בדיקת דפדפן של המסך האחיד (רשת מדומה, בלי אמולטור) ברוחב 360px: מנהל ועובד מחוברים, ערכות "לוגו" וכהה-זהב ("מאפייה כהה").
// שימוש: NODE_PATH=/opt/npm-tools/node_modules node ui-us3.js <www-dir> [shots-dir]
const fs = require('fs'); const path = require('path'); const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 300) : '')); };
// "חשבונית" לדוגמה (קנבס) כ-PNG, בגדלים שונים לכל עמוד
const mkImg = (page, w, h, label) => page.evaluate(([w, h, label]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#222'; x.font = 'bold 40px sans-serif'; x.fillText(label, 30, 70); for (let i = 0; i < 14; i++) { x.fillRect(30, 120 + i * 40, w - 60 - (i % 3) * 80, 8); } x.strokeRect(10, 10, w - 20, h - 20); return c.toDataURL('image/png').split(',')[1]; }, [w, h, label]).then((b) => Buffer.from(b, 'base64'));
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) }; }, sel);
(async () => {
  const [www, shots] = process.argv.slice(2); if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const THEMES = [['logo', 'logo'], ['kahe-zahav', 'baked']];
  for (const [tn, tv] of THEMES) {
    const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 }); await H.login(page, 'm@x.co');
    await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 500);
    await page.evaluate((v) => { S.theme = v; render(0); }, tv);
    const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, tn + '-' + n + '.png') }); };
    const T = tn + ' ';
    // 1. נקודת כניסה של המנהל: פלוס ← כפתור אחד "הכנסת מסמכים" (לא "הכנסה"/"הוצאה")
    await page.click('.bar .fab'); await H.settle(page, 300);
    const t1 = await page.evaluate(() => ({ us: document.querySelectorAll('#sheet [data-a=usOpen]').length, oldInc: document.querySelectorAll('#sheet [data-a=pick][data-v=inc]').length, oldExp: document.querySelectorAll('#sheet [data-a=pick][data-v=exp]').length }));
    check(T + '1 פלוס: כפתור "הכנסת מסמכים" במקום הכנסה והוצאה', t1.us === 1 && !t1.oldInc && !t1.oldExp, t1); await shot('01-פלוס');
    await page.click('#sheet [data-a=usOpen]'); await H.settle(page, 300);
    const t2 = await page.evaluate(() => ({ inputs: document.querySelectorAll('#sheet input[type=file]').length, cam: [...document.querySelectorAll('#sheet input[type=file]')].some((i) => i.hasAttribute('capture')), pdf: !!document.querySelector('#sheet input[accept="application/pdf"]'), man: !!document.querySelector('#sheet [data-a=usManual]') }));
    check(T + '2 מסך פתיחה: שלוש בחירות קובץ (מצלמה, גלריה, PDF) והכנס ידני', t2.inputs === 3 && t2.pdf && t2.man, t2); await shot('02-פתיחה');
    // 3. בחירת תמונה עם זיהוי מדומה (חשבונית, תאריך וסכום לא בטוחים) ← חצי שמאלי תמונה, טופס בימני
    await page.evaluate(() => { window.USCLS = async () => ({ kind: 'invoice', conf: 0.7, unsure: ['date', 'amt'] }); });
    await page.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'inv.png', mimeType: 'image/png', buffer: await mkImg(page, 600, 800, 'INV 1') }); await H.settle(page, 2500);
    const pane = await rect(page, '#uspane'), sheet = await rect(page, '#sheet'), img = await page.evaluate(() => { const i = document.getElementById('usimg'); return i && { nw: i.naturalWidth, vis: i.getBoundingClientRect().width > 20 }; });
    check(T + '3 התמונה בחצי השמאלי והטופס בימני (360px)', pane && pane.x === 0 && Math.abs(pane.w - 180) <= 2 && sheet && Math.abs(sheet.x - 180) <= 2 && img && img.nw > 0 && img.vis, { pane, sheet, img });
    const t3 = await page.evaluate(() => ({ crumb: [...document.querySelectorAll('#sheet .crumbs .chip')].map((x) => x.textContent), badge: document.querySelector('.ust').textContent, sel: document.querySelector('#uspane select').value, bar: getComputedStyle(document.querySelector('.bar')).display }));
    check(T + '3א זוהתה חשבונית: נפתח אשף ההוצאה הקיים (קטגוריות), הסוג מוצג ואפשר לשנותו', t3.crumb.includes('הוצאה') && /זוהה: חשבונית/.test(t3.badge) && t3.sel === 'exp' && t3.bar === 'none', t3); await shot('03-תמונה-וקטגוריה');
    // 4. קטגוריית ספקים ← מדלגים על שלב הסריקה הישן, ישר לספק; ספק חדש ← טופס הפרטים עם שדות לא בטוחים בצהוב
    await page.click('#sheet [data-a=pick][data-v=e_sup]'); await H.settle(page, 300);
    const t4 = await page.evaluate(() => ({ step: A.step, scanUi: !!document.querySelector('#sheet [data-a=scanGo],#sheet [data-c=scanpick]'), fid: !!A.fid }));
    check(T + '4 קטגוריית ספקים: בלי שלב הסריקה הישן, התמונה נשמרת לצירוף (A.fid)', t4.step === 'sub' && !t4.scanUi && t4.fid, t4);
    await page.fill('#sheet form[data-f=subnew] input[name=name]', 'ספק בדיקה'); await page.click('#sheet form[data-f=subnew] button'); await H.settle(page, 400);
    const t5 = await page.evaluate(() => ({ fields: [...document.querySelectorAll('#sheet form[data-f=addsave] [name]')].map((e) => e.name), yellow: [...document.querySelectorAll('#sheet .usu')].map((e) => e.name), notes: document.querySelectorAll('#sheet .usn').length }));
    check(T + '5 טופס חשבונית ספק קיים (סכום, תאריך, חודש, מספר) וצהוב רק על date ו-amt', ['amt', 'date', 'plan', 'inv'].every((f) => t5.fields.includes(f)) && t5.yellow.sort().join() === 'amt,date' && t5.notes === 2, t5); await shot('05-טופס-צהוב');
    // 5א. עריכה מורידה את הצהוב
    await page.fill('#sheet input[name=amt]', '123.45'); const y2 = await page.evaluate(() => [...document.querySelectorAll('#sheet .usu')].map((e) => e.name));
    check(T + '5א עריכת שדה מסירה ממנו את הצהוב', y2.join() === 'date', y2);
    // 6. הקו הנגרר: 25%–75%
    const dv = await rect(page, '#usdiv'); const cy = 400;
    await page.mouse.move(dv.x + 15, cy); await page.mouse.down(); await page.mouse.move(20, cy, { steps: 5 }); await page.mouse.up(); await H.settle(page, 200);
    const pL = await rect(page, '#uspane'); await page.mouse.move((await rect(page, '#usdiv')).x + 15, cy); await page.mouse.down(); await page.mouse.move(350, cy, { steps: 5 }); await page.mouse.up(); await H.settle(page, 200);
    const pR = await rect(page, '#uspane'), saved = await page.evaluate(() => localStorage.getItem('lp-usf')), shL = await rect(page, '#sheet');
    check(T + '6 הקו נגרר ונשמר בתחום 25%–75%', Math.abs(pL.w - 90) <= 2 && Math.abs(pR.w - 270) <= 2 && saved === '0.75' && Math.abs(shL.x - 270) <= 2, { pL: pL.w, pR: pR.w, saved }); await shot('06-קו-75');
    await page.keyboard.press('Escape'); await page.focus('#usdiv'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await H.settle(page, 100);
    const pK = await rect(page, '#uspane'); check(T + '6א הקו זז גם במקלדת (חצים)', Math.abs(pK.w - 180) <= 2, pK.w);
    // 7. הגדלה, סיבוב, מעבר בין דפים, מסך מלא
    await page.click('#uspane [data-a=usZoom][data-d="1"]'); const z1 = await page.evaluate(() => document.getElementById('usimg').style.transform);
    check(T + '7 כפתור הגדלה מגדיל את התמונה', /scale\(1\.[0-9]+\)/.test(z1), z1);
    await page.click('#uspane [data-a=usZoom][data-d="-1"]'); await page.click('#uspane [data-a=usZoom][data-d="-1"]');
    const nw0 = await page.evaluate(() => document.getElementById('usimg').naturalWidth); await page.click('#uspane [data-a=usRot]'); await H.settle(page, 400);
    const nw1 = await page.evaluate(() => ({ nw: document.getElementById('usimg').naturalWidth, nh: document.getElementById('usimg').naturalHeight }));
    check(T + '7א סיבוב ידני מחליף רוחב וגובה', nw1.nw > nw0 && nw0 === nw1.nh, { nw0, nw1 });
    await page.setInputFiles('#uspane input[type=file]', { name: 'inv2.png', mimeType: 'image/png', buffer: await mkImg(page, 500, 700, 'INV 2') }); await H.settle(page, 2000);
    const c2 = await page.evaluate(() => document.querySelector('#uspane .usc') && document.querySelector('#uspane .usc').textContent);
    check(T + '7ב הוספת עמוד: מוני עמודים וחיצים', c2 === '2/2', c2);
    await page.click('#uspane [data-a=usNav][data-d="-1"]'); const c1 = await page.evaluate(() => document.querySelector('#uspane .usc').textContent); check(T + '7ג חץ לעמוד הקודם', c1 === '1/2', c1); await shot('07-שני-עמודים');
    await page.click('#usv'); await H.settle(page, 200);
    const fu = await rect(page, '#uspane'), dvh = await page.evaluate(() => document.getElementById('usdiv').hidden);
    check(T + '7ד לחיצה על התמונה פותחת מסך מלא עם סגירה', fu.w === 360 && fu.h >= 700 && dvh, { fu, dvh }); await shot('07-מסך-מלא');
    await page.click('#uspane .usph [data-a=usFull]'); await H.settle(page, 200); const bk = await rect(page, '#uspane'); check(T + '7ה סגירת מסך מלא', Math.abs(bk.w - 180) <= 2, bk);
    // 8. שמירה ← "נשמר" + סרוק עוד + חזרה; הקובץ נצמד לחשבונית
    await page.fill('#sheet input[name=inv]', 'T-1001'); const before = await page.evaluate(() => S.tx.length);
    await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 700);
    const t8 = await page.evaluate(() => { const t = S.tx[S.tx.length - 1]; return { n: S.tx.length, amt: t.amt, inv: t.inv, file: !!t.file, again: !!document.querySelector('#sheet [data-a=usAgain]'), back: !!document.querySelector('#sheet [data-a=usExit]'), pane: document.getElementById('uspane').hidden }; });
    check(T + '8 אחרי שמירה: "סרוק עוד" + חזרה, רשומה אחת, הקובץ מצורף', t8.n === before + 1 && t8.amt === 123.45 && t8.inv === 'T-1001' && t8.file && t8.again && t8.back && t8.pane, t8); await shot('08-נשמר');
    await page.click('#sheet [data-a=usAgain]'); await H.settle(page, 300);
    check(T + '8א "סרוק עוד" חוזר למסך הפתיחה', await page.evaluate(() => !!document.querySelector('#sheet [data-c=uspick]')));
    // 9. זיהוי לא ידוע ← בורר סוג ליד התמונה; החלפת סוג אחרי בחירה
    await page.evaluate(() => { window.USCLS = async () => ({ kind: 'unknown' }); });
    await page.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'x.png', mimeType: 'image/png', buffer: await mkImg(page, 600, 800, 'UNKNOWN') }); await H.settle(page, 2500);
    const t9 = await page.evaluate(() => ({ opts: [...document.querySelectorAll('#sheet [data-a=usPick]')].map((b) => b.dataset.k), pane: !document.getElementById('uspane').hidden }));
    check(T + '9 מסמך לא מזוהה: בורר סוג (כל הסוגים) ליד התמונה', t9.pane && ['exp', 'cashout', 'deposit', 'transfer', 'z', 'opening', 'inc'].every((k) => t9.opts.includes(k)), t9); await shot('09-בורר-סוג');
    await page.click('#sheet [data-a=usPick][data-k=exp]'); await H.settle(page, 300);
    const stepExp = await page.evaluate(() => A && A.step); await page.selectOption('#uspane select', 'z'); await H.settle(page, 300); await page.click('#dlg [data-a=yes]'); await H.settle(page, 1500);
    const t9b = await page.evaluate(() => ({ view: cur().v, z0: !!(ZC && ZC.z[0]), us: document.body.classList.contains('us-on'), sheetHidden: document.getElementById('sheet').hidden }));
    check(T + '9א החלפת סוג אחרי זיהוי: טופס הסוג החדש (דוח Z) נפתח והתמונה נטענת בו', stepExp === 'cat' && t9b.view === 'zc' && t9b.z0 && t9b.us && t9b.sheetHidden, t9b); await shot('09-דוח-Z');
    await page.selectOption('#uspane select', 'transfer'); await H.settle(page, 300); await page.click('#dlg [data-a=yes]'); await H.settle(page, 1500);
    const t9c = await page.evaluate(() => ({ view: cur().v, items: TR.items.length, us: document.body.classList.contains('us-on') }));
    check(T + '9ב סוג העברה: המסך הקיים של ההעברה נפתח עם התמונה', t9c.view === 'tr' && t9c.items === 1 && t9c.us, t9c); await shot('09-העברה');
    await page.click('#bk'); await H.settle(page, 500);
    const t9d = await page.evaluate(() => ({ us: document.body.classList.contains('us-on'), pane: document.getElementById('uspane').hidden }));
    check(T + '9ג יציאה מהמסך הקיים סוגרת את חלונית התמונה', !t9d.us && t9d.pane, t9d);
    // 10. הכנס ידני
    await page.evaluate(() => usOpen()); await page.click('#sheet [data-a=usManual]'); await H.settle(page, 300);
    // חלק ב': נוסף סוג "צ׳ק" (מנהל); חלק ג': "דף בנק / אשראי" (מנהל) – 9 סוגים
    const t10 = await page.evaluate(() => ({ opts: document.querySelectorAll('#sheet [data-a=usPick]').length, us: document.body.classList.contains('us-on') }));
    check(T + '10 הכנס ידני: בורר סוג בלי תמונה', t10.opts === 9 && !t10.us, t10); await shot('10-ידני');
    await page.click('#sheet [data-a=usPick][data-k=exp]'); await H.settle(page, 300);
    check(T + '10א ידני ← אשף ההוצאה הקיים', await page.evaluate(() => A && A.step === 'cat' && A.us === 1));
    await page.click('#sheet [data-a=sheetBack]'); await H.settle(page, 300); check(T + '10ב חזרה מהאשף ← בורר הסוג', await page.evaluate(() => !!document.querySelector('#sheet [data-a=usPick]')));
    await page.click('#sheet [data-a=usExit]'); await H.settle(page, 300); check(T + '10ג סגירה', await page.evaluate(() => document.getElementById('sheet').hidden && !US));
    // 11. כפתור "סריקה" הישן במסך עוד פותח את המסך החדש
    await page.evaluate(() => { NAV = [{ v: 'home' }]; go('more'); }); await H.settle(page, 300);
    await page.evaluate(() => { const b = document.querySelector('[data-a=go][data-v=scan]'); if (b) b.click(); }); await H.settle(page, 300);
    check(T + '11 הכפתור הישן "סריקת חשבוניות" פותח את המסך החדש', await page.evaluate(() => !!document.querySelector('#sheet [data-c=uspick]')));
    await page.evaluate(() => usReset());
    check(T + '12 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors); await ctx.close();

    // עובד: אותו מסך, עם הטופס הקיים של העובד
    const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 }); await H.login(wp, 'w@x.co');
    await wp.evaluate((v) => { const c = cfgLocal(); c.th = v; localStorage.setItem(CK, JSON.stringify(c)); render(0); }, tv); // עובד: הערכה נשמרת בהגדרות המקומיות של העובד
    const wshot = async (n) => { if (shots) await wp.screenshot({ path: path.join(shots, tn + '-' + n + '.png') }); };
    await wshot('20-עובד-בית');
    check(T + '20 עובד: כפתור "סריקה" במקום "הוצאה"', await wp.evaluate(() => !!document.querySelector('[data-a=usOpen]') && !document.querySelector('.tile.exp[data-a=wkGoExp]')));
    await wp.click('[data-a=usOpen]'); await H.settle(wp, 300);
    await wp.evaluate(() => { window.USCLS = async () => ({ kind: 'invoice', unsure: ['date'] }); });
    await wp.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'w.png', mimeType: 'image/png', buffer: await mkImg(wp, 600, 800, 'WORKER') }); await H.settle(wp, 2500);
    const t20 = await wp.evaluate(() => ({ form: !!document.querySelector('form[data-f=wksave]'), pages: WK.pages.length, us: document.body.classList.contains('us-on'), pane: Math.round(document.getElementById('uspane').getBoundingClientRect().width), main: Math.round(document.getElementById('main').getBoundingClientRect().x), yellow: [...document.querySelectorAll('#main .usu')].map((e) => e.name) }));
    check(T + '21 עובד: הטופס הקיים ליד התמונה, הצילום מצורף, צהוב על התאריך', t20.form && t20.pages === 1 && t20.us && Math.abs(t20.pane - 180) <= 2 && t20.main >= 178 && t20.yellow.join() === 'date', t20); await wshot('21-עובד-טופס');
    await wp.evaluate(() => ACT.back()); await H.settle(wp, 500);
    const t22 = await wp.evaluate(() => ({ us: document.body.classList.contains('us-on'), ws: WS })); check(T + '22 עובד: חזרה סוגרת את התמונה וחוזרת לבית', !t22.us && t22.ws === 'home', t22);
    check(T + '23 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors); await w.ctx.close();
  }
  // עסק חדש בלי זיהוי חכם וללא "סגירת קופה": הודעה, בורר בלי הסוגים שאינם זמינים לו
  { const c2 = { mode: 'new', users: { ma: 'acme', wa: 'acme' }, biz: { acme: { dataRoot: 'b', features: {} } }, admins: { 'b/acme/|ma': 1 }, staff: { 'b/acme/|wa': 1 } };
    const w = await H.newPage(browser, www, c2, [], 'w2'); const p = w.page; await p.setViewportSize({ width: 360, height: 740 }); await H.login(p, 'wa@x.co'); await H.settle(p, 500);
    await p.evaluate(() => { const b = document.querySelector('[data-a=usOpen]'); if (b) b.click(); }); await H.settle(p, 300);
    const t = await p.evaluate(() => ({ off: /הזיהוי החכם כבוי/.test(document.getElementById('sheet').innerText) })); check('30 עסק בלי זיהוי חכם: הודעה במסך הפתיחה', t.off, t);
    await p.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'w.png', mimeType: 'image/png', buffer: await mkImg(p, 600, 800, 'W') }); await H.settle(p, 2500);
    const t2 = await p.evaluate(() => ({ opts: [...document.querySelectorAll('#sheet [data-a=usPick]')].map((b) => b.dataset.k), pane: !document.getElementById('uspane').hidden }));
    check('31 בלי זיהוי חכם: בורר סוג ליד התמונה, ובו רק סוגים שמותר לעובד (בלי Z, פתיחה, הפקדה, העברה, הכנסה)', t2.pane && t2.opts.sort().join() === 'cashout,exp', t2);
    check('32 אין שגיאות JS', p.__errors.length === 0, p.__errors); await w.ctx.close(); }
  await browser.close(); console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
