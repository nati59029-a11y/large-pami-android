'use strict';
// "מכירות כספית" כתוספת נפרדת (19.11.2026): עסק בלי התוספת – לא רואים את המסך בכלל; עסק עם התוספת – המנהל רואה ובוחר אילו עובדים רואים.
// עובד מסומן (staff/{uid}.cxS) – כפתור בבית, מסך בלי "התאמה לסגירת קופה", בלי "לא בטוח" ובלי קליטה. רשת מדומה, נתונים מומצאים.
// שימוש: node ui-cx-see.js <www-dir> [out.json] [shots-dir]. מסך טלפון קטן (360×740).
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const CC = require('../../functions/lib/caspit-core.js');
const out = {}; let fail = 0;
const check = (name, ok, info) => { out[name] = { ok: !!ok, info }; if (!ok) fail++; console.log((ok ? 'עבר  ' : 'נכשל ') + name + (info !== undefined ? ' | ' + JSON.stringify(info).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = { orders: true };
const ON = { orders: true, cxSales: true };
const it = (n, cat, q, a) => ({ n, cat, q, r: 0, a, ds: 0, u: 0 });
const SALES = { ...CC.packDays([{ d: '2026-11-03', bk: '6200', bn: 'סניף בדיקה', gross: 30, ret: 0, disc: 0, ntx: 2, nl: 2, sp: 0, un: 1, it: { 400001: it('כוס נייר', 'k1', 3, 30) } }]), cats: { k1: 'כלים' }, cfg: { reg: {}, br: '_' }, sa: false };
const SV = (v) => ({ stringValue: v });
const STAFF = { documents: [
  { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/staff/w1', fields: { name: SV('דוד בדיקה'), email: SV('w1@x.co'), role: SV('employee'), active: { booleanValue: true } } },
  { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/staff/w2', fields: { name: SV('משה בדיקה'), email: SV('w2@x.co'), role: SV('employee'), active: { booleanValue: true }, cxS: { booleanValue: true } } },
  { name: 'projects/demo-largpeami/databases/(default)/documents/b/biz-o/staff/m', fields: { name: SV('המנהל'), role: SV('manager'), active: { booleanValue: true } } }] };

async function open(browser, www, feats, user, staffDoc, shots, tag) {
  const cfg = { mode: 'new', users: { [user]: 'biz-o' }, biz: { 'biz-o': { dataRoot: 'b', features: feats, name: 'עסק בדיקה' } }, ctx: { hasTouch: true, isMobile: true } };
  if (user === 'm') cfg.admins = { 'b/biz-o/|m': 1 }; else cfg.staff = { ['b/biz-o/|' + user]: staffDoc || 1 };
  const log = []; const calls = [];
  const x = await H.newPage(browser, www, cfg, log, tag);
  await x.ctx.route(/:8080\/.*/, async (route) => {
    const u = new URL(route.request().url()); const p = decodeURIComponent(u.pathname);
    if (/\/b\/biz-o\/staff$/.test(p) && route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STAFF) });
    return route.fallback();
  });
  await x.ctx.route(/:5001\/.*/, async (route) => {
    const n = new URL(route.request().url()).pathname.split('/').pop(); let d = {}; try { d = JSON.parse(route.request().postData()).data; } catch (e) { /* */ }
    calls.push({ n, d });
    const R = { cxSales: SALES, cxSee: { ok: true, uid: d && d.uid, on: d && d.on }, cxCfg: { cfg: { skip: [], last: null }, items: 0, br: '_', sa: false } };
    if (R[n]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: R[n] }) });
    return route.fallback();
  });
  await x.page.setViewportSize({ width: 360, height: 740 });
  await H.login(x.page, user + '@x.co');
  await x.page.evaluate(() => { const s = document.getElementById('sheet'); if (s && !s.hidden && typeof ACT.startBlank === 'function') ACT.startBlank(); }).catch(() => {}); // חלון פתיחה של עסק חדש (כמו ui-cx-sales)
  x.calls = calls; x.shot = async (nm) => { if (shots) await x.page.screenshot({ path: path.join(shots, tag + '-' + nm + '.png') }).catch(() => {}); };
  return x;
}
const view = (pg, v) => pg.evaluate((vv) => { NAV = [{ v: vv }]; render(0); }, v).then(() => sleep(1200));
const txt = (pg) => pg.evaluate(() => document.querySelector('main') ? document.querySelector('main').innerText : document.body.innerText);

(async () => {
  const [www, outFile, shots] = process.argv.slice(2);
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await H.launch();
  try {
    // ===== 1. עסק בלי התוספת: המנהל לא רואה כלום =====
    { const x = await open(browser, www, BASE, 'm', null, shots, 'off'); const pg = x.page;
      await view(pg, 'more'); const t = await txt(pg);
      check('1 בלי התוספת: אין "מכירות כספית" ב"עוד"', !t.includes('מכירות כספית'), t.slice(0, 200));
      const f = await pg.evaluate(() => [cxSalesOk(), cxSalesView(), cxSalesPay()]);
      check('1א בלי התוספת: אין הרשאה לאף אחד (מנהל / צפייה / שכר)', f.every((v) => v === false), f);
      await view(pg, 'cxSync'); const s = await txt(pg);
      check('1ב מסך סנכרון כספית: בלי כפתור המכירות ובלי "דוח מכירות לפריטים"', !s.includes('מכירות כספית והתאמה') && !s.includes('דוח מכירות לפריטים'), s.slice(0, 300));
      await view(pg, 'cxSales'); const e = await txt(pg);
      check('1ג כניסה ישירה למסך – "אין לך הרשאה", בלי קריאה לשרת', e.includes('אין לך הרשאה') && !x.calls.some((c) => c.n === 'cxSales'), e.slice(0, 120));
      check('1ד בלי שגיאות JavaScript', !pg.__errors.length, pg.__errors);
      await x.shot('more'); await x.ctx.close(); }

    // ===== 2. עסק עם התוספת: המנהל רואה ובוחר עובדים =====
    { const x = await open(browser, www, ON, 'm', null, shots, 'mgr'); const pg = x.page;
      await view(pg, 'more'); const t = await txt(pg);
      check('2 עם התוספת: "מכירות כספית" ב"עוד" למנהל', t.includes('מכירות כספית'));
      await view(pg, 'cxSales'); await sleep(800); const s = await txt(pg);
      check('2א מסך המכירות למנהל: כולל "התאמה לסגירת קופה", "לא בטוח" ו"עובדים שרואים את המסך"', s.includes('התאמה לסגירת קופה') && s.includes('לא בטוח') && s.includes('עובדים שרואים את המסך'), s.slice(0, 300));
      await pg.evaluate(() => document.querySelector('[data-a=go][data-v=cxSee]').click()); await sleep(1200); const l = await txt(pg);
      check('2ב רשימת עובדים: שני העובדים, בלי המנהל', l.includes('דוד בדיקה') && l.includes('משה בדיקה') && !l.includes('המנהל'), l.slice(0, 300));
      const st = await pg.evaluate(() => [...document.querySelectorAll('[data-c=cxSeeT]')].map((e) => [e.dataset.uid, e.checked, Math.round(e.closest('label').getBoundingClientRect().height)]));
      check('2ג המצב הנוכחי מסומן (w2 רואה, w1 לא); שורה ≥44 לגעת', JSON.stringify(st.map((r) => r.slice(0, 2))) === JSON.stringify([['w1', false], ['w2', true]]) && st.every((r) => r[2] >= 44), st);
      await x.shot('see');
      await pg.evaluate(() => document.querySelector('[data-c=cxSeeT][data-uid=w1]').click()); await sleep(900);
      const c = x.calls.filter((k) => k.n === 'cxSee');
      check('2ד סימון עובד שולח cxSee { uid:w1, on:true }', c.length === 1 && c[0].d.uid === 'w1' && c[0].d.on === true, c);
      const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
      check('2ה בלי גלילה לצד', sw <= 360, sw);
      check('2ו בלי שגיאות JavaScript', !pg.__errors.length, pg.__errors);
      await x.ctx.close(); }

    // ===== 3. עובד מסומן: כפתור בבית, צפייה בלבד =====
    { const x = await open(browser, www, ON, 'w2', { cxS: true, perms: { ord: true } }, shots, 'emp'); const pg = x.page;
      await pg.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await sleep(900);
      const b = await pg.evaluate(() => !!document.querySelector('[data-a=go][data-v=cxSales]'));
      check('3 עובד מסומן: כפתור "מכירות כספית" בבית', b);
      await x.shot('home');
      await view(pg, 'cxSales'); await sleep(800); const s = await txt(pg);
      check('3א מסך המכירות לעובד: מוצרים וקופות, בלי "התאמה לסגירת קופה", בלי "לא בטוח", בלי בחירת עובדים', s.includes('כוס נייר') && s.includes('קופות') && !s.includes('התאמה לסגירת קופה') && !s.includes('לא בטוח') && !s.includes('עובדים שרואים'), s.slice(0, 300));
      const p = await pg.evaluate(() => [cxSalesOk(), cxSalesView()]);
      check('3ב עובד: צפייה כן, ניהול לא', p[0] === false && p[1] === true, p);
      await view(pg, 'cxSee'); const e = await txt(pg);
      check('3ג עובד לא נכנס לבחירת העובדים', e.includes('למנהל בלבד'), e.slice(0, 80));
      check('3ד בלי שגיאות JavaScript', !pg.__errors.length, pg.__errors);
      await x.shot('sales'); await x.ctx.close(); }

    // ===== 4. עובד לא מסומן =====
    { const x = await open(browser, www, ON, 'w1', { perms: { ord: true } }, shots, 'emp0'); const pg = x.page;
      await pg.evaluate(() => { WS = 'home'; NAV = [{ v: 'wk' }]; render(0); }); await sleep(900);
      const b = await pg.evaluate(() => !!document.querySelector('[data-a=go][data-v=cxSales]'));
      check('4 עובד לא מסומן: אין כפתור בבית', !b);
      await view(pg, 'cxSales'); const e = await txt(pg);
      check('4א כניסה ישירה – "אין לך הרשאה", בלי קריאה לשרת', e.includes('אין לך הרשאה') && !x.calls.some((c) => c.n === 'cxSales'), e.slice(0, 80));
      await x.ctx.close(); }
  } catch (e) { console.error(e); fail++; }
  await browser.close();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(fail ? 'נכשלו ' + fail : 'עברו כולם');
  process.exit(fail ? 1 : 0);
})();
