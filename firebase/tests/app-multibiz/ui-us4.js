'use strict';
// סריקה אחידה, שלב 4: חיבור classify (רשת מדומה; scanDocument מדומה לכל בדיקה). רשומה אחת בדיוק, ניסיון חוזר, מכסה, הרשאות, כפילות, קבלה, eu.
// שימוש: NODE_PATH=... node ui-us4.js <www-dir>
const H = require('./harness');
const BZ0 = ['larg', 'peami'].join('');
const ALL = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
let fail = 0; const check = (n, ok, info) => { if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + n + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 300) : '')); };
const mkImg = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 560; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 560); x.fillStyle = '#222'; x.fillRect(20, 40, 300, 20); return c.toDataURL('image/png').split(',')[1]; }).then((b) => Buffer.from(b, 'base64'));
// תור תשובות: כל קריאה ל-scanDocument לוקחת את הבאה. {err:reason} = שגיאה
async function mockScan(page) {
  page.__q = []; page.__calls = 0;
  await page.route('**/scanDocument', async (route) => {
    page.__calls++; const body = JSON.parse(route.request().postData() || '{}'); page.__lastKind = body.data && body.data.kind;
    const a = page.__q.shift() || { err: 'bad-answer' };
    if (a.err) return route.fulfill({ status: a.err === 'biz-daily-limit' ? 429 : 500, contentType: 'application/json', body: JSON.stringify({ error: { status: a.err === 'biz-daily-limit' ? 'RESOURCE_EXHAUSTED' : 'INTERNAL', message: 'x', details: { reason: a.err } } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { result: a }, usage: {} }) });
  });
}
const INV = (o) => Object.assign({ type: 'invoice', docType: 'invoice', typeConfidence: 0.95, allowed: true, fields: { supplier: 'ספק אלפא', number: 'A-77', date: '2026-11-01', total_with_vat: 117 }, confidence: {}, uncertain: [] }, o || {});
async function scanFile(page) { await page.setInputFiles('#sheet input[accept="image/*"][multiple]', { name: 'd.png', mimeType: 'image/png', buffer: await mkImg(page) }); await H.settle(page, 2500); }
(async () => {
  const [www] = process.argv.slice(2); const browser = await H.launch();
  const cfg = { mode: 'new', biz: { [BZ0]: { dataRoot: 'legacy', features: ALL } }, admins: { '|m': 1 }, staff: { '|w': 1 } };
  const { ctx, page } = await H.newPage(browser, www, cfg, [], 'm'); await page.setViewportSize({ width: 360, height: 740 }); await mockScan(page); await H.login(page, 'm@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden) ACT.startBlank(); }); await H.settle(page, 400);
  await page.evaluate(() => { const c = S.cats.find((x) => x.beh === 'sup'); const s = { id: 'sAlpha', cat: c.id, name: 'ספק אלפא' }; S.subs.push(s); save(); });
  const open = async () => { await page.evaluate(() => usOpen()); await H.settle(page, 200); };
  // 1. חשבונית: classify נקרא פעם אחת, ספק מזוהה → ישר לפרטים, שדות מלאים, שמירה = רשומה אחת עם eu
  await open(); page.__q = [INV({ uncertain: ['date'] })]; page.__calls = 0; await scanFile(page);
  const t1 = await page.evaluate(() => { const f = document.querySelector('#sheet form[data-f=addsave]'); return f && { step: A.step, sub: A.sub, amt: f.amt.value, inv: f.inv.value, date: f.date.value, y: [...document.querySelectorAll('#sheet .usu')].map((e) => e.name) }; });
  check('1 חשבונית: ספק לפי שם → פרטים מלאים, צהוב על התאריך', t1 && t1.sub === 'sAlpha' && t1.amt === '117' && t1.inv === 'A-77' && t1.date === '2026-11-01' && t1.y.join() === 'date' && page.__calls === 1 && page.__lastKind === 'classify', { t1, calls: page.__calls });
  let n0 = await page.evaluate(() => S.tx.length); await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 600);
  const t1b = await page.evaluate((n) => { const t = S.tx[S.tx.length - 1]; return { d: S.tx.length - n, eu: t.eu, file: !!t.file, again: !!document.querySelector('[data-a=usAgain]') }; }, n0);
  check('1א שמירה: רשומה אחת בדיוק, eu = המנהל, קובץ מצורף, "סרוק עוד"', t1b.d === 1 && t1b.eu === 'm' && t1b.file && t1b.again, t1b);
  // 2. כפילות: אותו מספר+ספק → חלון כפילות; החלפת תמונה = אין רשומה חדשה, הקובץ מתחלף
  await open(); page.__q = [INV()]; await scanFile(page); n0 = await page.evaluate(() => S.tx.length);
  const oldFile = await page.evaluate(() => S.tx[S.tx.length - 1].file);
  await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 400);
  const dupUi = await page.evaluate(() => !!document.querySelector('#dlg [data-a=usDupRep]'));
  await page.click('#dlg [data-a=usDupRep]'); await H.settle(page, 400);
  const t2 = await page.evaluate(([n, of]) => { const t = S.tx[S.tx.length - 1]; return { d: S.tx.length - n, nf: t.file !== of && !!t.file }; }, [n0, oldFile]);
  const oldKept = await page.evaluate(async (of) => !!(await fget(of)), oldFile);
  check('2 כפילות חוסמת; החלפת תמונה: רשומה אחת, קובץ חדש, הישן לא נמחק', dupUi && t2.d === 0 && t2.nf && oldKept, { dupUi, t2, oldKept });
  // 3. קבלה לחשבונית קיימת → משויכת, סך ההוצאות לא משתנה
  await open(); page.__q = [INV({ docType: 'receipt', fields: { supplier: 'ספק אלפא', number: 'R-1', related_invoice: 'A-77', date: '2026-11-02', total_with_vat: 117 } })]; await scanFile(page);
  n0 = await page.evaluate(() => S.tx.length); await page.click('#sheet form[data-f=addsave] button[value=done]'); await H.settle(page, 400);
  const rq = await page.evaluate(() => !!document.querySelector('#dlg [data-a=yes]')); if (rq) { await page.click('#dlg [data-a=yes]'); await H.settle(page, 400); }
  check('3 קבלה לחשבונית קיימת: אין הוצאה נוספת', rq && (await page.evaluate((n) => S.tx.length - n, n0)) === 0);
  // 4. ניסיון חוזר: שני כשלים ואז הצלחה = 3 קריאות, נפתח טופס
  await open(); page.__q = [{ err: 'bad-answer' }, { err: 'overloaded' }, INV({ fields: { supplier: 'ספק אלפא', number: 'A-90', date: '2026-11-03', total_with_vat: 50 } })]; page.__calls = 0; await scanFile(page); await H.settle(page, 2500);
  check('4 ניסיון חוזר: 2 כשלים ואז הצלחה (3 קריאות)', page.__calls === 3 && (await page.evaluate(() => A && A.step === 'det')), page.__calls);
  await page.evaluate(() => usReset());
  // 4א. 3 כשלים → בורר + "נסה שוב"; לחיצה = ניסיון נוסף
  await open(); page.__q = [{ err: 'bad-answer' }, { err: 'bad-answer' }, { err: 'bad-answer' }]; page.__calls = 0; await scanFile(page); await H.settle(page, 3000);
  const t4 = await page.evaluate(() => ({ retry: !!document.querySelector('#sheet [data-a=usRetry]'), opts: document.querySelectorAll('#sheet [data-a=usPick]').length }));
  check('4א אחרי 3 כשלים: בורר סוג ידני + "נסה שוב"', page.__calls === 3 && t4.retry && t4.opts > 0, { calls: page.__calls, t4 });
  page.__q = [INV()]; await page.click('#sheet [data-a=usRetry]'); await H.settle(page, 1500);
  check('4ב "נסה שוב" שולח ניסיון נוסף', page.__calls === 4); await page.evaluate(() => usReset());
  // 5. מכסה נגמרה → בלי ניסיון חוזר, בורר ידני עם הודעה
  await open(); page.__q = [{ err: 'biz-daily-limit' }]; page.__calls = 0; await scanFile(page);
  const t5 = await page.evaluate(() => ({ txt: document.getElementById('sheet').innerText, opts: document.querySelectorAll('#sheet [data-a=usPick]').length }));
  check('5 מכסה נגמרה: קריאה אחת, הודעה ובורר ידני', page.__calls === 1 && /מכסת/.test(t5.txt) && t5.opts > 0, { calls: page.__calls });
  await page.evaluate(() => usReset());
  // 6. הוצאה מקופה: סימון "מקופה" + סכום מלא; שמירה = רשומה אחת
  await open(); page.__q = [{ type: 'cashout', allowed: true, fields: { amount: 42, date: '2026-11-02', register: '6346053' }, confidence: {}, uncertain: [] }]; await scanFile(page);
  await page.evaluate(() => { const c = catsOf('exp').find((x) => x.beh === 'free'); ACT.pick({ dataset: { k: 'cat', v: c.id } }); }); await H.settle(page, 400);
  const t6 = await page.evaluate(() => { const f = document.querySelector('#sheet form[data-f=addsave]'); return f && { co: f.co && f.co.checked, amt: f.amt.value, creg: f.creg && f.creg.value }; });
  check('6 הוצאה מקופה: סכום וקופה מהזיהוי, "מקופה" מסומן', t6 && t6.co && t6.amt === '42' && t6.creg === 'i_yh', t6);
  await page.evaluate(() => usReset());
  // 7. העברה: נפתח מסך ההעברה עם השורה שזוהתה – בלי קריאה נוספת לשרת
  await open(); page.__q = [{ type: 'transfer', allowed: true, fields: { transfers: [{ amount: 300, date: '2026-11-01', payee_name: 'ספק אלפא', payee_account: { bank: '12', branch: '1', account: '9' }, reference: '55' }] }, confidence: {}, uncertain: [] }]; page.__calls = 0; await scanFile(page); await H.settle(page, 800);
  const t7 = await page.evaluate(() => ({ v: cur().v, n: TR.items.length, amt: TR.items[0] && TR.items[0].rows[0].amt }));
  check('7 העברה: מסך ההעברה עם הסכום שזוהה, קריאה אחת בלבד', t7.v === 'tr' && t7.n === 1 && t7.amt === '300' && page.__calls === 1, { t7, calls: page.__calls });
  await page.click('#bk'); await H.settle(page, 400); await page.evaluate(() => { if (US) usReset(); });
  // 8. "צילום העברה" פותח את המסך האחיד
  await page.evaluate(() => ACT.trGo({ dataset: {} })); await H.settle(page, 200);
  check('8 "צילום העברה" פותח את המסך האחיד', await page.evaluate(() => !!document.querySelector('#sheet [data-c=uspick]'))); await page.evaluate(() => usReset());
  // 9. Z: השדות שבחלק הזה נטענים לטופס הסגירה
  await open(); page.__q = [{ type: 'zreport', zPart: 'bottom', allowed: true, fields: { total: 1000, cash: 400, report_no: '321', date: '2026-11-02' }, confidence: {}, uncertain: [] }]; await scanFile(page); await H.settle(page, 1200);
  const t9 = await page.evaluate(() => ({ v: cur().v, z2: !!ZC.z[2], tot: ZC.f && ZC.f.total, no: ZC.f && ZC.f.no }));
  check('9 דוח Z: חלק תחתון במקום 3, סכומים ומספר דוח בטופס', t9.v === 'zc' && t9.z2 && t9.tot === '1000' && t9.no === '321', t9);
  await page.click('#bk'); await H.settle(page, 300); await page.evaluate(() => { if (US) usReset(); });
  // 10. eu בסגירה מעובד (zcIns) ובהכנסה ידנית
  const t10 = await page.evaluate(() => { const it = { id: 'zt1', reg: 'i_yh', by: 'w', ow: 'w', f: { d: '2026-11-02', no: '9' }, c: { rows: [{ sub: 'מזומן', amt: 10 }], c: 0, o: 0, a: 0, p: 0 } }; zcIns(it, 'm'); const z = S.tx.filter((t) => t.src === 'zc:zt1'); S.tx.push({ id: 'inc1', t: 'inc', cat: 'i_yh', sub: null, date: '2026-11-02', amt: 5, note: '' }); save(); return { z: z.map((t) => t.eu), inc: S.tx.find((t) => t.id === 'inc1').eu }; });
  check('10 eu: סגירה מעובד = העובד; הכנסה של המנהל = המנהל', t10.z.length === 1 && t10.z[0] === 'w' && t10.inc === 'm', t10);
  check('11 אין שגיאות JS (מנהל)', page.__errors.length === 0, page.__errors); await ctx.close();
  // עובד: חשבונית מזוהה → טופס העובד עם הסכום והמספר; סוג חסום (העברה) → לא נפתח, הודעה "למנהל"
  const w = await H.newPage(browser, www, cfg, [], 'w'); const wp = w.page; await wp.setViewportSize({ width: 360, height: 740 }); await mockScan(wp); await H.login(wp, 'w@x.co');
  await wp.click('[data-a=usOpen]'); await H.settle(wp, 300); wp.__q = [INV()]; await scanFile(wp);
  const t20 = await wp.evaluate(() => ({ amt: WK.amt, inv: WK.inv, date: WK.date, pages: WK.pages.length }));
  check('20 עובד: טופס עם סכום, מספר ותאריך מהזיהוי', t20.amt === '117' && t20.inv === 'A-77' && t20.date === '2026-11-01' && t20.pages === 1, t20);
  await wp.evaluate(() => ACT.back()); await H.settle(wp, 400);
  await wp.evaluate(() => usOpen()); await H.settle(wp, 200); wp.__q = [{ type: 'transfer', allowed: false, reason: 'no-perm', toManager: true, fields: {}, confidence: {}, uncertain: [] }]; await scanFile(wp);
  const t21 = await wp.evaluate(() => ({ txt: document.getElementById('sheet').innerText, opts: [...document.querySelectorAll('#sheet [data-a=usPick]')].map((b) => b.dataset.k) }));
  check('21 עובד: סוג חסום – הודעה "למנהל", ובבורר אין העברה', /למנהל/.test(t21.txt) && !t21.opts.includes('transfer'), t21);
  check('22 אין שגיאות JS (עובד)', wp.__errors.length === 0, wp.__errors); await w.ctx.close();
  await browser.close(); console.log(fail ? 'נכשלו ' + fail : 'כל הבדיקות עברו'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
