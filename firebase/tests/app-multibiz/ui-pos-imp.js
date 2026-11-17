'use strict';
// 17.11.2026 (קופה – אשף ייבוא מכספיט, ענף feature/pos-import): www/pos-import.js מול רשת מדומה.
// מנהל: כניסה מההגדרות (רק כשמתג הקופה פעיל), קובץ CSV בעברית ב-windows-1255 (קובץ דוגמה מומצא), זיהוי עמודות, מיפוי מחלקות,
// בדיקת כפילויות בשרת, תצוגה מקדימה (חדשים / כפולים / שגויים / לא פעילים), ייבוא במנות, יומן וביטול ייבוא. 360px בלי גלילה לרוחב.
// עובד, ומנהל כשהמתג כבוי – אין כניסה ואין קריאה לשרת.
// שימוש: node ui-pos-imp.js <www-dir> [out.json] [shots-dir]
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 500) : '')); };
const BASE = Object.fromEntries(['scan', 'shelf', 'feedback', 'tasks', 'suppliers', 'requests', 'cashClose', 'yemot', 'orders'].map((k) => [k, true]));
const FX = path.join(__dirname, '..', 'fixtures', 'pos-import');
const T2 = Date.UTC(2026, 10, 16, 9, 0, 0);
const LIST = [{ id: 'AAAAAAAAAAAAAAAAAAAA', kind: 'prod', src: 'xlsx', file: 'פריטים.xlsx', rows: 1200, added: 1180, dup: 15, bad: 5, at: T2, undone: false, skipped: [{ n: 4, why: 'exists' }] },
  { id: 'BBBBBBBBBBBBBBBBBBBB', kind: 'cust', src: 'csv', file: 'לקוחות.csv', rows: 300, added: 290, dup: 10, bad: 0, at: T2 - 1000, undone: false, skipped: [] }];

async function open(browser, www, who, calls, pos) {
  const F = Object.assign({ pos }, BASE);
  const cfg = { mode: 'new', users: { m: 'biz-o', w: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: F, name: 'עסק בדיקה' } }, admins: { 'b/biz-o/|m': 1 }, staff: { 'b/biz-o/|w': 1 } };
  const log = [];
  const { ctx, page } = await H.newPage(browser, www, cfg, log, 'pim' + who + (pos ? 1 : 0));
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  let undoN = 0;
  await ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    let R = { ok: true };
    if (n === 'posImpList') R = { ok: true, list: LIST, cats: [{ id: 'c_bake', name: 'מאפים', parent: '' }, { id: 's_x', name: 'תת', parent: 'c_bake' }] };
    else if (n === 'posImpCheck') R = { ok: true, ex: d.kind === 'prod' ? [0] : [] }; // הברקוד הראשון כבר קיים במערכת
    else if (n === 'posImport') R = { ok: true, job: d.job, added: d.rows.length, dup: 0, bad: 0, skipped: [] };
    else if (n === 'posImpUndo') { undoN++; R = { ok: true, off: 150, kept: undoN === 1 ? 1 : 0, left: undoN === 1 ? 900 : 0 }; }
    else if (n === 'getCosts') R = { cost: {} };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R }) });
  });
  await H.login(page, who + '@x.co');
  await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && ACT.startBlank) ACT.startBlank(); });
  await page.setViewportSize({ width: 360, height: 740 });
  return { ctx, page, log };
}

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (page, n) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
  const browser = await H.launch();
  const view = async (page, v) => { await page.evaluate((a) => go(a), v); await H.settle(page, 1000); await page.evaluate((a) => go(a), v); await H.settle(page, 400);
    return page.evaluate(() => { const m = document.getElementById('main'); return { t: m.innerText, file: !!m.querySelector('[data-c=piFile]'), entry: !!m.querySelector('[data-v=posImp]'), undo: m.querySelectorAll('[data-a=piUndo]').length, ov: document.documentElement.scrollWidth - innerWidth }; }); };
  const dlgT = (page) => page.evaluate(() => { const d = document.querySelector('#dlg'); return d && d.open ? d.innerText : ''; });

  // ---------- מנהל, הקופה פעילה ----------
  { const calls = []; const { ctx, page, log } = await open(browser, www, 'm', calls, true);
    const st = await view(page, 'settings');
    check('m 1 הגדרות: "קופה" ← "ייבוא מכספיט"', st.entry && /ייבוא מכספיט/.test(st.t), { t: st.t.slice(0, 200) });
    const v = await view(page, 'posImp'); await shot(page, 'm-01-מסך');
    check('m 2 מסך הייבוא: בחירת קובץ, יומן ייבוא, "ביטול ייבוא" רק למוצרים, בלי גלילה לרוחב ב-360px',
      v.file && /יומן ייבוא/.test(v.t) && /פריטים\.xlsx/.test(v.t) && /לקוחות\.csv/.test(v.t) && v.undo === 1 && v.ov <= 0 && calls.some((c) => c.n === 'posImpList'), { undo: v.undo, ov: v.ov });
    // קובץ דוגמה מומצא ב-windows-1255
    await page.setInputFiles('[data-c=piFile]', { name: 'SAMPLE-products-windows-1255.csv', mimeType: 'text/csv', buffer: fs.readFileSync(path.join(FX, 'SAMPLE-products-windows-1255.csv')) }); await H.settle(page, 800);
    const mp = await page.evaluate(() => [...document.querySelectorAll('#dlg form[data-f=piMapF] select[name^=m]')].map((s) => s.value));
    const mt = await dlgT(page); await shot(page, 'm-02-עמודות');
    check('m 3 windows-1255: הכותרות בעברית נקראות ומזוהות (ברקוד, שם, מחיר, עלות, מחלקה, פעיל); הקידוד מוצג',
      JSON.stringify(mp) === JSON.stringify(['barcode', 'name', 'price', 'cost', 'cat', 'active']) && /windows-1255/.test(mt) && /9 שורות/.test(mt), { mp, mt: mt.slice(0, 160) });
    await page.click('#dlg form[data-f=piMapF] button:not([type=button])'); await H.settle(page, 500);
    const cm = await page.evaluate(() => [...document.querySelectorAll('#dlg form[data-f=piCatF] select')].map((s) => s.value));
    check('m 4 מיפוי מחלקות: "מאפים" ← הקטגוריה הקיימת, השאר – חדשה (C19-013)', JSON.stringify(cm) === JSON.stringify(['+', '+', 'c_bake']), cm);
    let n0 = calls.length;
    await page.click('#dlg form[data-f=piCatF] button:not([type=button])'); await H.settle(page, 1200);
    const ck = calls.slice(n0).filter((c) => c.n === 'posImpCheck');
    const pv = await dlgT(page); await shot(page, 'm-03-תצוגה-מקדימה');
    check('m 5 בדיקת כפילויות בשרת (8 מפתחות), תצוגה מקדימה: 6 חדשים (2 עם סימון: חסר מחיר / ברקוד לבדיקה – P1) · 2 קיימים / כפולים · 0 שגויים · 1 לא פעיל; "קיים במערכת – דילגתי"',
      ck.length === 1 && ck[0].d.keys.length === 8 && ck[0].d.keys[0].bc === '7290000001012' && /6\s*חדשים/.test(pv) && /2\s*קיימים \/ כפולים/.test(pv) && /0\s*שגויים/.test(pv) && /2 מהחדשים ייובאו עם סימון/.test(pv) && /חסר מחיר/.test(pv) && /1\s*לא פעילים/.test(pv) && /קיים במערכת – דילגתי/.test(pv) && /כפול בקובץ/.test(pv),
      { keys: ck[0] && ck[0].d.keys.length, pv: pv.slice(0, 300) });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    n0 = calls.length;
    await page.click('#dlg [data-a=piGo]'); await H.settle(page, 1200);
    const run = calls.slice(n0).filter((c) => c.n === 'posImport');
    const done = await dlgT(page);
    const r0 = run[0] && run[0].d;
    check('m 6 ייבוא: קריאה אחת עם 6 השורות החדשות בלבד (כולל חסר מחיר = 0 ו-bcRaw), job של 20 תווים, מחלקה קיימת = cid, חדשה = cat; "הייבוא הסתיים"; בלי גלילה לרוחב',
      run.length === 1 && r0.rows.length === 6 && r0.rows.some((r) => r.price === 0) && r0.rows.some((r) => r.bcRaw === '7.29E+12') && /^[A-Za-z0-9]{20}$/.test(r0.job) && r0.kind === 'prod' && r0.src === 'csv' && r0.total === 6 && r0.at === 0
      && r0.rows.find((r) => /עוגת שמרים/.test(r.name)).cid === 'c_bake' && r0.rows.find((r) => /כוסות/.test(r.name)).cat === 'חד פעמי' && !r0.rows.some((r) => r.barcode === '7290000001012') && /הייבוא הסתיים/.test(done) && ov <= 0,
      { rows: r0 && r0.rows, done: done.slice(0, 160) });
    await page.evaluate(() => closeDlg());
    // ביטול ייבוא
    await view(page, 'posImp');
    n0 = calls.length;
    await page.click('[data-a=piUndo]'); await H.settle(page, 300);
    const ask = await dlgT(page);
    await page.click('#dlg [data-a=yes]'); await H.settle(page, 1500);
    const uc = calls.slice(n0).filter((c) => c.n === 'posImpUndo');
    check('m 7 ביטול ייבוא: שאלת אישור ("שום דבר לא נמחק"), ואז posImpUndo עד left=0', /שום דבר לא נמחק/.test(ask) && uc.length === 2 && uc[0].d.job === 'AAAAAAAAAAAAAAAAAAAA', { n: uc.length, ask: ask.slice(0, 160) });
    // פירוט
    await view(page, 'posImp'); await page.click('[data-a=piLog]'); await H.settle(page, 300);
    const lg = await dlgT(page);
    check('m 8 פירוט ייבוא: "שורה 4 – קיים – דילגתי"', /שורה 4 – קיים – דילגתי/.test(lg), lg.slice(0, 200));
    await page.evaluate(() => closeDlg());
    // לקוחות
    await view(page, 'posImp'); await page.click('[data-a=piK][data-v=cust]'); await H.settle(page, 300);
    await page.setInputFiles('[data-c=piFile]', { name: 'SAMPLE-customers-windows-1255.csv', mimeType: 'text/csv', buffer: fs.readFileSync(path.join(FX, 'SAMPLE-customers-windows-1255.csv')) }); await H.settle(page, 800);
    const cmap = await page.evaluate(() => [...document.querySelectorAll('#dlg form[data-f=piMapF] select[name^=m]')].map((s) => s.value));
    n0 = calls.length;
    await page.click('#dlg form[data-f=piMapF] button:not([type=button])'); await H.settle(page, 1200);
    const cpv = await dlgT(page);
    const cck = calls.slice(n0).filter((c) => c.n === 'posImpCheck');
    check('m 9 לקוחות: עמודות (שם, טלפון, ת"ז, מייל), בדיקה בשרת לפי טלפון / ת"ז, 3 חדשים · 1 כפול · 3 שגויים',
      JSON.stringify(cmap) === JSON.stringify(['name', 'phone', 'tz', 'mail']) && cck.length === 1 && cck[0].d.keys[0].ph === '0500000001' && /3\s*חדשים/.test(cpv) && /1\s*קיימים/.test(cpv) && /3\s*שגויים/.test(cpv), { cmap, cpv: cpv.slice(0, 200) });
    await page.evaluate(() => closeDlg());
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('m 10 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  // ---------- מנהל, הקופה כבויה ----------
  { const calls = []; const { ctx, page, log } = await open(browser, www, 'm', calls, false);
    const st = await view(page, 'settings');
    const v = await view(page, 'posImp');
    check('off 1 מתג הקופה כבוי: אין כניסה בהגדרות, המסך "למנהל בלבד…", אין קריאה לשרת', !st.entry && !v.file && !calls.some((c) => /^posImp/.test(c.n)), { t: v.t.slice(0, 80) });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('off 2 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  // ---------- עובד ----------
  { const calls = []; const { ctx, page, log } = await open(browser, www, 'w', calls, true);
    const st = await view(page, 'settings');
    const v = await view(page, 'posImp');
    check('w 1 עובד: אין כניסה בהגדרות, "למנהל בלבד", בלי קובץ ובלי קריאה לשרת', !st.entry && /למנהל בלבד/.test(v.t) && !v.file && !calls.some((c) => /^posImp/.test(c.n)), { t: v.t.slice(0, 80) });
    const errs = log.filter((x) => /pageerror|TypeError|ReferenceError/.test(x));
    check('w 2 בלי שגיאות JS', errs.length === 0, errs.slice(0, 3));
    await ctx.close(); }

  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ out }, null, 1));
  console.log(fail ? `תוצאה: נכשל (${fail})` : 'תוצאה: הכול עבר'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
